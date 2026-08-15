/**
 * GymSpeak Runner
 * Juego de dos carriles controlado con el cuerpo a través de la cámara.
 * La detección de pose (MediaPipe) se carga bajo demanda: nada pesa hasta
 * que el usuario pulsa "Jugar con la cámara". Todo corre en el dispositivo.
 *
 * Aquí vive la lógica; el dibujo está en render.js.
 */

import { initRender, setSize, renderFrame, renderIdle, fx, setZona, zonaNombre, setCalidad } from './render.js';
import { pickPattern, sacoGolpea, MOV_FIN, azar, nuevaSemilla, setSemilla } from './patterns.js';
import { initAudio, toggleAudio, audioActivo, sfx } from './audio.js';

// ================= Ajustes =================
const DETECT_INTERVAL = 45;      // ms entre inferencias (~22 fps), el juego va a 60
const CALIB_MS = 3000;           // duración de la calibración
// La puntuación es el TIEMPO que aguantas, y nada más. Las vidas son tres y no
// hay forma de conseguir más. No hay nada que recoger: lo único que se premia
// es esquivar apurado, y eso no suma puntos, solo se celebra.
const ZONA_SEGUNDOS = 15;        // cada cuánto cambias de sala del gimnasio
// 70 ms: tiene que ser RARO. Con 150 saltaba cada dos por tres y dejaba de
// significar nada. Un premio que sale siempre no es un premio.
const PERFECTO_MS = 70;
const MARCA_SEGUNDOS = 10;       // cada cuánto plantas una marca de tiempo
// Clave nueva: los récords viejos estaban en kilos y ahora son segundos
const RECORD_KEY = 'gymspeak-runner-record-tiempo';
// Dos carriles (-1 izquierda, 1 derecha): con tres, un paso largo se saltaba
// el centro y contaba doble, y además obligaba a tener más espacio en casa.
// El salto se mide en DISTANCIA, no en tiempo: cuanto más rápido va la cinta,
// menos dura el salto. Si no, llega un momento en que saltas un obstáculo y te
// comes el siguiente sí o sí. Los topes evitan que sea imposible de ejecutar
// con el cuerpo, que tiene su propia latencia.
const JUMP_Z = 0.30;             // lo que avanza la pista mientras estás en el aire
const JUMP_MS_MIN = 340;
const JUMP_MS_MAX = 700;
const DUCK_Z = 0.17;
const DUCK_MS_MIN = 230;
const DUCK_MS_MAX = 420;
// Si pulsas saltar mientras aún estás en el aire, la orden NO se tira: se
// guarda y sale sola en cuanto tocas suelo. Sin esto, dos obstáculos seguidos
// eran imposibles porque la segunda pulsación se perdía.
// 420 ms es a propósito más generoso que en un plataformas normal (100-200):
// con la cámara el cuerpo se adelanta y pulsas mucho antes de tocar suelo.
const JUMP_BUFFER_MS = 420;
const DEATH_MS = 1100;           // lo que dura la caída antes del resumen
const HIT_GRACE_MS = 1100;       // invulnerabilidad tras un golpe
const PESO_REF = 70;             // kg de referencia para estimar las calorías
const SPEED_START = 0.45;        // unidades de profundidad por segundo
const SPEED_MAX = 1.15;
const SPEED_RAMP = 0.018;        // incremento por segundo

// Umbrales de gesto, normalizados por el tamaño del cuerpo en pantalla
const T_LATERAL = 0.26;          // paso corto a un lado para cambiar de carril
                                 // (por debajo hay zona muerta: mantiene el carril)
const T_DUCK = 0.26;             // caída de cadera respecto al torso
const T_JUMP_RISE = 0.075;       // subida de cadera respecto al torso
const T_JUMP_VEL = 0.55;         // velocidad de subida (torsos por segundo)
const JUMP_COOLDOWN = 520;

// ================= DOM =================
const $ = (id) => document.getElementById(id);
const stage = $('stage');
const canvas = $('gameCanvas');
const ctx = canvas.getContext('2d');
const camBox = $('camBox');
const video = $('cam');
const camOverlay = $('camOverlay');
const camCtx = camOverlay.getContext('2d');
const camTag = $('camTag');
const hud = $('hud');
const scoreEl = $('score');
const perfectosEl = $('perfectos');
const livesEl = $('lives');
const flashEl = $('gestureFlash');
const overlay = $('overlay');
const panels = {
    start: $('panelStart'),
    loading: $('panelLoading'),
    preview: $('panelPreview'),
    calib: $('panelCalib'),
    error: $('panelError'),
    login: $('panelLogin'),
    cola: $('panelCola'),
    duelo: $('panelDuelo'),
    pause: $('panelPause'),
    over: $('panelOver')
};

// ================= Estado =================
const game = {
    running: false,
    lane: -1,
    laneVisual: -1,     // interpolado, para que el cambio de carril no sea un salto
    jumpUntil: 0,
    duckUntil: 0,
    obstacles: [],
    speed: SPEED_START,
    combo: 0,
    lives: 3,
    lastHit: -9999,
    nextSpawn: 0,
    runPhase: 0,
    roadPhase: 0,
    startedAt: 0,
    paused: false,
    perfectos: 0,           // esquives apurados de la partida
    perfectosSeguidos: 0,   // encadenados sin comerte un golpe
    ultimoCambio: -9999,    // cuándo cambiaste de carril por última vez
    proximaMarca: 0,
    lastPattern: null,
    dying: 0,           // instante en que empieza la caída final
    kcal: 0,
    metros: 0,
    segundos: 0,
    // El render los necesita para animar el salto y la caída
    jumpMs: JUMP_MS_MAX,
    deathMs: DEATH_MS
};

/** Duración del salto y del agachado según lo rápido que vaya la cinta. */
const jumpDur = (speed) => Math.min(JUMP_MS_MAX, Math.max(JUMP_MS_MIN, JUMP_Z / speed * 1000));
const duckDur = (speed) => Math.min(DUCK_MS_MAX, Math.max(DUCK_MS_MIN, DUCK_Z / speed * 1000));

const input = {
    mode: 'keys',       // 'keys' | 'pose'
    lane: -1,
    jumpQueued: 0,      // instante en que se pidió el salto, 0 = nada pendiente
    ducking: false,
    tracked: false
};

/** Apunta la intención de saltar; el bucle decide cuándo puede ejecutarla. */
function pedirSalto(cuando) {
    input.jumpQueued = cuando || performance.now();
}

let logicalW = 900;
let logicalH = 560;

// ================= Utilidades de dibujo =================
function resizeCanvas() {
    const rect = stage.getBoundingClientRect();
    // Si aún no tiene tamaño real (el CSS no ha aterrizado, o la pestaña está
    // oculta) NO se toca el lienzo: si no, se queda de dos píxeles y no se
    // vuelve a arreglar solo. El observador de más abajo llamará otra vez.
    if (rect.width < 40 || rect.height < 40) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    // El lienzo copia la forma REAL del hueco, no una proporción fija. Así en
    // el móvil en vertical el juego se dibuja vertical de verdad en lugar de
    // estirarse: es el CSS quien decide la forma y el render se adapta.
    let w = rect.width;
    let h = rect.height;
    const TOPE = 900;                 // por encima de esto no compensa dibujar
    if (w > TOPE) { h = h * TOPE / w; w = TOPE; }
    if (h > TOPE) { w = w * TOPE / h; h = TOPE; }
    logicalW = w;
    logicalH = h;

    canvas.width = Math.round(logicalW * dpr);
    canvas.height = Math.round(logicalH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    setSize(logicalW, logicalH);
}

function flash(text) {
    flashEl.textContent = text;
    flashEl.hidden = true;
    void flashEl.offsetWidth; // reinicia la animación
    flashEl.hidden = false;
}

// ================= Lógica del juego =================
/** Suelta un tramo entero de golpe: cada pieza en su z relativa. */
function spawnPattern() {
    const p = pickPattern(game.speed, game.lastPattern);
    game.lastPattern = p;
    for (const it of p.items) {
        game.obstacles.push({
            type: it.t,
            lane: it.lane,
            destino: it.destino,        // solo lo usa el balón
            alto: !!it.alto,
            z: 1.25 + it.dz,
            // Desfase propio: dos sacos seguidos no oscilan a la vez
            fase: azar() * 4000,
            resolved: false
        });
    }
    // El hueco se mide en distancia, no en tiempo: así el ritmo aguanta al acelerar
    game.nextSpawn = (p.len + 0.38 + azar() * 0.22) / game.speed;
}

/**
 * ¿Te ha pillado, y si no, por qué pelos?
 *
 * Ya no hay nada que recoger. Lo único que se premia es esquivar BIEN: si te
 * libras por los pelos —saltando justo, agachándote justo o cambiándote en el
 * último momento— salta un PERFECTO. Es el único "premio" del juego, y no se
 * puede farmear: hay que apurar de verdad.
 */
function resolve(o, now) {
    const jumping = now < game.jumpUntil;
    const ducking = now < game.duckUntil;
    const sameLane = o.lane === game.lane;

    // La escalera de agilidad es suelo pintado: ni golpea ni da nada
    if (o.type === 'escalon') return;

    let hit = false;
    let via = null;          // cómo te libraste: 'salto' | 'agachado' | 'carril'

    if (o.type === 'saco') {
        // Solo golpea si está encima de tu carril de verdad, no por el signo
        const encima = sacoGolpea(o, now, game.lane);
        hit = encima && !ducking;
        via = encima ? 'agachado' : 'carril';
    } else if (o.type === 'cuerda') {
        // Barre los dos carriles: cambiarse no sirve, o saltas o nada
        hit = !jumping;
        via = 'salto';
    } else if (o.type === 'balon') {
        // Llega rodando al carril destino; o lo saltas o le dejas sitio
        const encima = o.destino === game.lane;
        hit = encima && !jumping;
        via = encima ? 'salto' : 'carril';
    } else if (sameLane) {
        // Prensa y polea bajan igual, pero paran a distinta altura y eso decide
        // el gesto: la que se queda en el suelo se salta, la del pecho se pasa
        // por debajo. Nunca al revés.
        if (o.type === 'banco') {
            hit = true;
        } else if (o.type === 'barra' || o.type === 'prensa') {
            hit = !jumping;
            via = 'salto';
        } else if (o.type === 'dominadas' || o.type === 'polea') {
            hit = !ducking;
            via = 'agachado';
        }
    } else {
        via = 'carril';      // estaba en el otro carril: te apartaste
    }

    if (hit) {
        if (now - game.lastHit < HIT_GRACE_MS) return; // aún invulnerable
        game.lastHit = now;
        game.lives--;
        game.combo = 0;
        game.perfectosSeguidos = 0;
        flash('¡Ay!');
        fx.hit(game.lane);
        sfx.golpe();
        // El navegador la bloquea si aún no ha habido un toque: no es un fallo
        try { navigator.vibrate?.(120); } catch { /* ignorado */ }
        if (game.lives <= 0) gameOver(now);
        return;
    }

    game.combo++;
    fx.dodge(game.lane);

    // ¿Por cuánto te has librado? Cuanto menos margen, más mérito.
    let margen = Infinity;
    if (via === 'salto' && jumping) {
        // Lo que llevas en el aire y lo que te queda: el mérito está en los bordes
        margen = Math.min(now - (game.jumpUntil - game.jumpMs), game.jumpUntil - now);
    } else if (via === 'agachado' && ducking) {
        margen = Math.min(now - game.duckStarted, game.duckUntil - now);
    } else if (via === 'carril') {
        // Solo cuenta si te has cambiado hace nada; estar ya ahí no tiene mérito
        margen = now - game.ultimoCambio;
    }

    if (margen < PERFECTO_MS) {
        game.perfectos++;
        game.perfectosSeguidos++;
        fx.perfecto(game.lane, game.perfectosSeguidos);
        sfx.perfecto(game.perfectosSeguidos);
    }
}

function update(dt, now) {
    // Durante la caída no se juega: la cinta frena y solo corre la animación
    if (game.dying) {
        const frenada = Math.max(0, 1 - (now - game.dying) / DEATH_MS);
        game.roadPhase = (game.roadPhase + dt * game.speed * 0.35 * frenada) % 1;
        for (const o of game.obstacles) o.z -= dt * game.speed * frenada;
        return;
    }

    // La velocidad sube SOLO con el tiempo. Nada más la toca.
    game.speed = Math.min(SPEED_MAX, SPEED_START + (now - game.startedAt) / 1000 * SPEED_RAMP);
    game.runPhase += dt * (6 + game.speed * 6);
    game.roadPhase = (game.roadPhase + dt * game.speed * 0.35) % 1;

    // Equivalencia con una cinta de verdad: de 8 a 16 km/h según la velocidad.
    // Es una ESTIMACIÓN para 70 kg, no una medición de lo que has quemado tú.
    const kmh = 8 + (game.speed - SPEED_START) / (SPEED_MAX - SPEED_START) * 8;
    const met = 0.85 * kmh + 1.5;
    game.kcal += met * 3.5 * PESO_REF / 200 / 60 * dt;
    game.metros += kmh / 3.6 * dt;
    game.segundos += dt;

    // Marca de tiempo al borde de la pista, como los carteles de una carrera
    if (game.segundos >= game.proximaMarca) {
        game.proximaMarca += MARCA_SEGUNDOS;
        fx.marcaTiempo(formatoTiempo(game.segundos));
    }

    // Cambio de sala: rompe la monotonía de correr siempre por el mismo sitio
    if (game.segundos >= game.proximaZona) {
        game.zona++;
        game.proximaZona += ZONA_SEGUNDOS;
        setZona(game.zona);
        // Sin cartel: el cambio se nota por el ambiente y el pórtico
        fx.cambioZona();
    }

    // Entrada. Saltar y agacharse son estados EXCLUSIVOS: en el aire no te
    // puedes agachar, y agachado no puedes despegar hasta que te levantas.
    if (input.lane !== game.lane) game.ultimoCambio = now;
    game.lane = input.lane;
    if (input.jumpQueued) {
        if (now >= game.jumpUntil && !input.ducking) {
            input.jumpQueued = 0;
            game.jumpMs = jumpDur(game.speed);
            game.jumpUntil = now + game.jumpMs;
            game.duckUntil = Math.min(game.duckUntil, now);   // corta el agachado
            flash('¡Salto!');
            fx.jump(game.lane);
            sfx.salto();
        } else if (now - input.jumpQueued > JUMP_BUFFER_MS) {
            input.jumpQueued = 0;   // caducó: no queremos saltos fantasma
        }
    }

    // Aterrizaje: polvo y una sacudida corta al tocar suelo
    const airborne = now < game.jumpUntil;
    if (game.wasAirborne && !airborne) {
        fx.land(game.lane);
        sfx.aterrizaje();
    }
    game.wasAirborne = airborne;

    if (input.ducking && !airborne) {
        // OJO con el orden: antes se leía duckStarted ANTES de asignarlo, así que
        // en el primer fotograma la cuenta salía negativa y el agachado duraba el
        // suelo de 110 ms. Resultado: te agachabas bien y la barra te daba igual.
        if (!game.wasDucking) {
            game.duckStarted = now;
            flash('¡Abajo!');
        }
        // Una vez abajo, se queda abajo su tiempo completo aunque sueltes la tecla
        const minimo = duckDur(game.speed);
        game.duckUntil = Math.max(game.duckUntil, Math.max(now + 110, game.duckStarted + minimo));
    }
    game.wasDucking = input.ducking && !airborne;

    // Suavizado del cambio de carril
    game.laneVisual += (game.lane - game.laneVisual) * Math.min(1, dt * 12);

    // Obstáculos
    for (const o of game.obstacles) {
        o.z -= dt * game.speed;
        // La barra de la máquina llega a su sitio: sacudida, polvo y sonido.
        // Es el aviso más claro de todos, porque no hay que estar mirándola.
        if (!o.avisado && o.z <= MOV_FIN &&
            (o.type === 'prensa' || o.type === 'polea' || o.type === 'cuerda')) {
            o.avisado = true;
            // La comba barre el centro, así que su golpe suena y se ve ahí
            fx.maquina(o.type === 'cuerda' ? 0 : o.lane, o.type === 'polea' ? 'polea' : 'prensa');
            if (o.type === 'polea') sfx.maquinaSube(); else sfx.maquinaBaja();
        }
        if (!o.resolved && o.z <= 0.02) {
            o.resolved = true;
            resolve(o, now);
        }
    }
    game.obstacles = game.obstacles.filter((o) => o.z > -0.25 && !o.muerto);

    // Generación por tramos, no por obstáculo suelto
    game.nextSpawn -= dt;
    if (game.nextSpawn <= 0) spawnPattern();

    // La puntuación es el tiempo aguantado, sin más
    // En duelo, el rival ve por dónde voy. Sale por la red cada 250 ms.
    if (duelo.activo && duelo.canal) duelo.canal.publicar(game.segundos, !game.dying);
    if (duelo.activo) pintarRival();

    scoreEl.textContent = formatoTiempo(game.segundos);
    perfectosEl.textContent = game.perfectos;
    const left = Math.max(0, game.lives);
    livesEl.textContent = '♥'.repeat(left) + '♡'.repeat(Math.max(0, 3 - left));
}

let lastFrame = 0;
function gameLoop(now) {
    if (!game.running || game.paused) return;
    const dt = Math.min(0.05, (now - lastFrame) / 1000 || 0);
    lastFrame = now;
    update(dt, now);
    renderFrame(game, now, dt);

    // La caída se ve entera antes de enseñar el resumen
    if (game.dying && now - game.dying >= DEATH_MS) {
        finishGame();
        return;
    }
    requestAnimationFrame(gameLoop);
}

let semillaForzada = 0;
/** Fuerza la semilla de la SIGUIENTE partida (lo usará el 1v1). */
export function jugarConSemilla(n) { semillaForzada = n >>> 0; }

function startGame() {
    Object.assign(game, {
        running: true,
        lane: -1,
        laneVisual: -1,
        jumpUntil: 0,
        duckUntil: 0,
        duckStarted: 0,
        wasDucking: false,
        obstacles: [],
        speed: SPEED_START,
        combo: 0,
        lives: 3,
        lastHit: -9999,
        nextSpawn: 1.4,
        wasAirborne: false,
        paused: false,
        perfectos: 0,
        perfectosSeguidos: 0,
        ultimoCambio: -9999,
        proximaMarca: MARCA_SEGUNDOS,
        lastPattern: null,
        dying: 0,
        kcal: 0,
        metros: 0,
        segundos: 0,
        zona: 0,
        proximaZona: ZONA_SEGUNDOS,
        jumpMs: JUMP_MS_MAX,
        startedAt: performance.now()
    });
    setZona(0);
    // Semilla de la partida. Hoy es al azar; en un uno contra uno bastará con
    // pasarle la misma a los dos para que corran la pista idéntica.
    game.semilla = semillaForzada || nuevaSemilla();
    semillaForzada = 0;
    fx.reset();
    input.lane = -1;
    input.jumpQueued = 0;
    overlay.hidden = true;
    hud.hidden = false;
    lastFrame = performance.now();
    requestAnimationFrame(gameLoop);
}

// ================= Récord =================
function loadRecord() {
    try { return parseInt(localStorage.getItem(RECORD_KEY) || '0', 10) || 0; }
    catch { return 0; }   // modo privado o almacenamiento bloqueado
}

function saveRecord(kilos) {
    try { localStorage.setItem(RECORD_KEY, String(kilos)); } catch { /* da igual */ }
}

function paintRecord() {
    const r = loadRecord();
    $('record').textContent = r ? formatoTiempo(r) : '—';
}

/** Se cae, y el resumen espera a que termine la animación. */
function gameOver(now) {
    if (game.dying) return;
    game.dying = now;   // el mismo reloj que el bucle, no performance.now()
    fx.death(game.lane);
}

function formatoTiempo(seg) {
    const m = Math.floor(seg / 60);
    const s = Math.floor(seg % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
}

function finishGame() {
    game.running = false;
    const segundos = Math.floor(game.segundos);
    const previo = loadRecord();
    const nuevo = segundos > previo;
    if (nuevo) {
        saveRecord(segundos);
        sfx.record();
    }

    $('finalScore').textContent = formatoTiempo(segundos);
    $('finalTitle').textContent = nuevo ? '¡Récord nuevo!' : 'Se acabó';
    $('finalLine').textContent = nuevo
        ? `Tu marca anterior era ${formatoTiempo(previo)}. Y ${game.perfectos} esquives al límite.`
        : game.perfectos > 0
            ? `${game.perfectos} esquives al límite. Tu récord sigue en ${formatoTiempo(previo)}.`
            : `Tu récord sigue en ${formatoTiempo(previo)}. Aguanta más y lo tumbas.`;
    // Resumen de la sesión, como si hubieras estado en la cinta de verdad
    const mediaKmh = game.segundos > 0 ? (game.metros / game.segundos) * 3.6 : 0;
    $('statTiempo').textContent = formatoTiempo(game.segundos);
    $('statDistancia').textContent = `${Math.round(game.metros)} m`;
    $('statRitmo').textContent = `${mediaKmh.toFixed(1)} km/h`;
    $('statKcal').textContent = `${Math.round(game.kcal)} kcal`;

    paintRecord();
    // La marca también sube a la clasificación, si hay sesión. No se espera a
    // que responda: que la red vaya lenta no puede retrasar el resultado.
    if (window.__subirMarca) window.__subirMarca(game.segundos);
    if (duelo.activo) { terminarDuelo(segundos); return; }
    showPanel('over');
}

// ================= Pausa =================
let pausedAt = 0;

function togglePause(forzar) {
    if (!game.running) return;
    const quiero = forzar === undefined ? !game.paused : forzar;
    if (quiero === game.paused) return;
    game.paused = quiero;

    if (game.paused) {
        pausedAt = performance.now();
        showPanel('pause');
    } else {
        // Todo lo que va con reloj se desplaza, o al volver estarías muerto
        const gap = performance.now() - pausedAt;
        game.startedAt += gap;
        game.jumpUntil += gap;
        game.duckUntil += gap;
        game.duckStarted += gap;
        game.lastHit += gap;
        lastFrame = performance.now();
        overlay.hidden = true;
        requestAnimationFrame(gameLoop);
    }
}

function showPanel(name) {
    overlay.hidden = false;
    for (const [key, el] of Object.entries(panels)) el.hidden = key !== name;
}

// ================= Entrada por teclado y táctil =================
window.addEventListener('keydown', (e) => {
    // La pausa funciona en los dos modos: con la cámara hace más falta todavía
    if ((e.key === 'p' || e.key === 'P' || e.key === 'Escape') && game.running) {
        togglePause();
        e.preventDefault();
        return;
    }
    if (input.mode !== 'keys' || !game.running || game.paused) return;
    switch (e.key) {
        case 'ArrowLeft': case 'a': case 'A':
            input.lane = -1; e.preventDefault(); break;
        case 'ArrowRight': case 'd': case 'D':
            input.lane = 1; e.preventDefault(); break;
        case 'ArrowUp': case 'w': case 'W': case ' ':
            pedirSalto(); e.preventDefault(); break;
        case 'ArrowDown': case 's': case 'S':
            input.ducking = true; e.preventDefault(); break;
    }
});

window.addEventListener('keyup', (e) => {
    if (input.mode !== 'keys') return;
    if (['ArrowDown', 's', 'S'].includes(e.key)) input.ducking = false;
});

// Deslizar el dedo, para el modo teclado en móvil
let touchStart = null;
stage.addEventListener('touchstart', (e) => {
    if (input.mode !== 'keys') return;
    touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}, { passive: true });

stage.addEventListener('touchend', (e) => {
    if (input.mode !== 'keys' || !touchStart) return;
    const dx = e.changedTouches[0].clientX - touchStart.x;
    const dy = e.changedTouches[0].clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(dx) < 30 && Math.abs(dy) < 30) return;
    if (Math.abs(dx) > Math.abs(dy)) {
        input.lane = dx > 0 ? 1 : -1;
    } else if (dy < 0) {
        pedirSalto();
    } else {
        input.ducking = true;
        setTimeout(() => { input.ducking = false; }, duckDur(game.speed));
    }
}, { passive: true });

// ================= Detección de pose =================
const pose = {
    landmarker: null,
    stream: null,
    base: null,
    prev: null,
    smooth: null,
    lastJump: 0,
    lastDuckEnd: 0,
    filtros: null,        // el filtro de un euro, uno por señal
    rachaSubida: 0,       // lecturas seguidas subiendo: hacen falta dos
    velPico: 0,           // la velocidad más alta reciente, con memoria corta
    ultimoBueno: 0,       // cuándo se vio un esqueleto fiable por última vez
    fase: 'juego',        // 'preview' | 'juego'
    running: false
};

const CONNECTIONS = [[11, 12], [11, 23], [12, 24], [23, 24], [11, 13], [13, 15], [12, 14], [14, 16], [23, 25], [25, 27], [24, 26], [26, 28]];

function cameraSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext;
}

function inAppBrowser() {
    return /FBAN|FBAV|Instagram|Line\/|TikTok|musical_ly|Snapchat|Twitter/i.test(navigator.userAgent);
}

async function loadDetector() {
    const { FilesetResolver, PoseLandmarker } = await import(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs'
    );
    const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
    );
    pose.landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
            delegate: 'GPU'
        },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
    });

    // Calentamiento: la primera inferencia compila los shaders y puede tardar
    // varios segundos. La gastamos aquí, con el spinner puesto, y no en pleno juego.
    const warm = document.createElement('canvas');
    warm.width = 640;
    warm.height = 480;
    const wctx = warm.getContext('2d');
    wctx.fillStyle = '#808080';
    wctx.fillRect(0, 0, warm.width, warm.height);
    for (let i = 0; i < 3; i++) {
        try {
            pose.landmarker.detectForVideo(warm, performance.now());
        } catch {
            // si el calentamiento falla seguimos: no es crítico
        }
        await new Promise((r) => setTimeout(r, 0));
    }
}

async function openCamera() {
    pose.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
        audio: false
    });
    video.srcObject = pose.stream;
    await video.play();
}

/**
 * Filtro «un euro».
 *
 * El suavizado de toda la vida (media exponencial con un factor fijo) te
 * obliga a elegir: o suavizas mucho y va con retraso, o suavizas poco y
 * tiembla. Este cambia el suavizado sobre la marcha — mucho cuando estás
 * quieto, para matar el temblor, y poco cuando te mueves rápido, para no
 * llegar tarde al salto. Es lo estándar para seguimiento corporal, y es la
 * razón principal de que antes respondiera raro.
 */
function filtroUnEuro(corteMin, beta) {
    let x = null, dx = 0, tPrev = 0;
    const alfa = (te, corte) => {
        const tau = 1 / (2 * Math.PI * corte);
        return 1 / (1 + tau / te);
    };
    return (valor, t) => {
        if (x === null) { x = valor; tPrev = t; return x; }
        const te = Math.min(0.2, Math.max(0.005, (t - tPrev) / 1000));
        tPrev = t;
        const bruto = (valor - x) / te;
        dx = alfa(te, 1) * bruto + (1 - alfa(te, 1)) * dx;
        const corte = corteMin + beta * Math.abs(dx);
        x = alfa(te, corte) * valor + (1 - alfa(te, corte)) * x;
        return x;
    };
}

/** Un filtro por señal. La cadera necesita ir más suelta: de ahí sale el salto. */
function nuevosFiltros() {
    return {
        hipY: filtroUnEuro(1.5, 2.5),
        shoulderY: filtroUnEuro(1.1, 0.6),
        centerX: filtroUnEuro(0.9, 0.4)
    };
}

/**
 * Saca del esqueleto lo poco que hace falta, y además cuenta cómo de fiable
 * es. Antes se descartaba el fotograma entero en cuanto un punto flojeaba;
 * ahora se devuelve igual con su nota, y quien lo usa decide.
 */
function measure(lm) {
    const clave = [11, 12, 23, 24];
    let vis = 0;
    for (const i of clave) {
        const p = lm[i];
        if (!p) return null;
        vis += (p.visibility === undefined ? 1 : p.visibility);
    }
    vis /= clave.length;

    // Coordenadas en espejo, para que "derecha" del usuario sea derecha en pantalla
    const mx = (i) => 1 - lm[i].x;
    const shoulderY = (lm[11].y + lm[12].y) / 2;
    const hipY = (lm[23].y + lm[24].y) / 2;
    const centerX = (mx(11) + mx(12) + mx(23) + mx(24)) / 4;
    const shoulderW = Math.abs(mx(11) - mx(12));
    const torso = hipY - shoulderY;
    if (torso <= 0.02 || shoulderW <= 0.02) return null;

    return { shoulderY, hipY, centerX, shoulderW, torso, vis };
}

/**
 * ¿Estás bien colocado? Lo usa la previsualización para decírtelo antes de
 * empezar, en vez de que lo descubras perdiendo.
 */
function calidadPose(m) {
    if (!m) return { ok: false, aviso: 'No te veo. Ponte delante de la cámara.' };
    if (m.vis < 0.65) return { ok: false, aviso: 'Te veo a medias. Busca más luz o apártate del fondo.' };
    if (m.torso < 0.10) return { ok: false, aviso: 'Estás muy lejos. Acércate un poco.' };
    if (m.torso > 0.34) return { ok: false, aviso: 'Estás muy cerca. Échate para atrás.' };
    if (Math.abs(m.centerX - 0.5) > 0.22) return { ok: false, aviso: 'Ponte en el centro del encuadre.' };
    return { ok: true, aviso: 'Perfecto, así.' };
}

function readGestures(m, now) {
    // Nota de fiabilidad. Si el esqueleto va flojo NO se toca nada: se
    // mantiene lo último bueno. Antes, un fotograma malo movía al muñeco solo.
    if (m.vis < 0.55) {
        if (now - pose.ultimoBueno > 600) input.ducking = false;  // por seguridad
        return;
    }
    pose.ultimoBueno = now;

    if (!pose.filtros) pose.filtros = nuevosFiltros();
    const s = {
        hipY: pose.filtros.hipY(m.hipY, now),
        shoulderY: pose.filtros.shoulderY(m.shoulderY, now),
        centerX: pose.filtros.centerX(m.centerX, now)
    };
    const base = pose.base;

    // ---- Lateral ----
    // Normalizado por la anchura de hombros: da igual a qué distancia estés.
    // Zona muerta en el centro: te quedas donde estabas, sin carril intermedio.
    const lateral = (s.centerX - base.centerX) / base.shoulderW;
    if (lateral > T_LATERAL) input.lane = 1;
    else if (lateral < -T_LATERAL) input.lane = -1;

    // ---- Agacharse ----
    // Dos umbrales distintos para entrar y salir. Con uno solo, quedarte justo
    // en la frontera hacía que el muñeco se agachara y levantara sin parar.
    const drop = (s.hipY - base.hipY) / base.torso;
    const wasDucking = input.ducking;
    input.ducking = wasDucking ? drop > T_DUCK * 0.62 : drop > T_DUCK;
    if (wasDucking && !input.ducking) pose.lastDuckEnd = now;

    // ---- Saltar ----
    // Sube por encima de la base Y sube deprisa, DOS lecturas seguidas. Con una
    // sola, cualquier tirón del esqueleto disparaba un salto fantasma.
    const rise = (base.hipY - s.hipY) / base.torso;
    if (pose.prev) {
        const dt = Math.max(0.001, (now - pose.prev.t) / 1000);
        const vel = (pose.prev.hipY - s.hipY) / base.torso / dt;
        // El pico de velocidad se recuerda un poco en vez de mirar solo la
        // lectura de ahora. Si no, pasa esto: el filtro retrasa la subida, y
        // para cuando supera el umbral de altura la velocidad ya está bajando
        // — el salto existía pero nunca coincidían las dos condiciones.
        pose.velPico = Math.max(vel, pose.velPico * 0.7);

        // El dato SIN filtrar es lo que separa un salto de verdad de un tirón
        // del esqueleto: en un salto el cuerpo se queda arriba varias lecturas,
        // mientras que un tirón vuelve al sitio en la siguiente. El filtro deja
        // una cola que se parece a un salto, y el crudo no.
        const riseCrudo = (base.hipY - m.hipY) / base.torso;
        const arriba = rise > T_JUMP_RISE && riseCrudo > T_JUMP_RISE * 0.6;
        pose.rachaSubida = arriba ? pose.rachaSubida + 1 : 0;

        // El enfriamiento evita leer un salto dos veces, pero no puede durar
        // más que el propio salto o a alta velocidad bloquea el siguiente
        const enfriamiento = Math.max(240, Math.min(JUMP_COOLDOWN, game.jumpMs * 0.85));
        const listo = now - pose.lastJump > enfriamiento && now - pose.lastDuckEnd > 300;
        if (listo && pose.rachaSubida >= 2 && pose.velPico > T_JUMP_VEL) {
            pedirSalto(now);
            pose.lastJump = now;
            pose.rachaSubida = 0;
            pose.velPico = 0;
        }
    }
    pose.prev = { hipY: s.hipY, t: now };

    // ---- La línea base se recalibra sola ----
    // Sin esto, en cuanto te desplazabas un poco de donde te calibraste, todo
    // se iba: el carril se quedaba pegado a un lado o el agachado dejaba de
    // detectar. Solo corrige mientras estás en reposo —ni saltando, ni
    // agachado, ni inclinado— así que no te roba el carril que estás
    // manteniendo a propósito.
    const enReposo = !input.ducking
        && now - pose.lastJump > 700
        && Math.abs(lateral) < 0.15
        && Math.abs(drop) < 0.10;
    if (enReposo) {
        const k = 0.012;               // unos 4 segundos para asentarse
        base.hipY += (s.hipY - base.hipY) * k;
        base.shoulderY += (s.shoulderY - base.shoulderY) * k;
        base.centerX += (s.centerX - base.centerX) * k;
        base.shoulderW += (m.shoulderW - base.shoulderW) * k;
        base.torso += (m.torso - base.torso) * k;
    }
}

function drawSkeleton(lm) {
    const w = camOverlay.width;
    const h = camOverlay.height;
    camCtx.clearRect(0, 0, w, h);
    if (!lm) return;
    camCtx.strokeStyle = '#34d27b';
    camCtx.lineWidth = 2;
    for (const [a, b] of CONNECTIONS) {
        if (!lm[a] || !lm[b]) continue;
        camCtx.beginPath();
        camCtx.moveTo(lm[a].x * w, lm[a].y * h);
        camCtx.lineTo(lm[b].x * w, lm[b].y * h);
        camCtx.stroke();
    }
    camCtx.fillStyle = '#f0f0f5';
    for (const i of [0, 11, 12, 23, 24, 15, 16]) {
        if (!lm[i]) continue;
        camCtx.beginPath();
        camCtx.arc(lm[i].x * w, lm[i].y * h, 3, 0, Math.PI * 2);
        camCtx.fill();
    }
}

// Bucle de detección, independiente del bucle del juego y con menos frecuencia
let lastDetect = 0;
const calib = { samples: [], startedAt: 0 };

function detectLoop() {
    if (!pose.running) return;
    const now = performance.now();
    if (video.readyState >= 2 && now - lastDetect >= DETECT_INTERVAL) {
        lastDetect = now;
        let result = null;
        try {
            result = pose.landmarker.detectForVideo(video, now);
        } catch {
            // un fotograma fallido no debe tumbar el bucle
        }
        const lm = result && result.landmarks && result.landmarks[0];
        drawSkeleton(lm);
        const m = lm ? measure(lm) : null;
        input.tracked = !!m;
        camTag.textContent = m ? 'Leyendo' : 'No te veo';
        camTag.classList.toggle('lost', !m);

        if (m) {
            if (pose.fase === 'preview') {
                // Antes de empezar solo se mira si estás bien colocado, y se
                // te dice. Vale más un aviso ahora que descubrirlo perdiendo.
                const q = calidadPose(m);
                $('previewAviso').textContent = q.aviso;
                $('previewAviso').classList.toggle('ok', q.ok);
                $('btnListo').disabled = !q.ok;
            } else if (!pose.base) {
                collectCalibration(m, now);
            } else if (game.running && !game.paused) {
                readGestures(m, now);
            }
        } else if (pose.fase === 'preview') {
            $('previewAviso').textContent = 'No te veo. Ponte delante de la cámara.';
            $('previewAviso').classList.remove('ok');
            $('btnListo').disabled = true;
        } else if (!pose.base) {
            $('calibState').textContent = 'Sitúate delante de la cámara…';
            $('calibState').classList.remove('ok');
            calib.samples = [];
            calib.startedAt = 0;
        }
    }
    requestAnimationFrame(detectLoop);
}

function collectCalibration(m, now) {
    if (!calib.startedAt) {
        calib.startedAt = now;
        calib.samples = [];
        $('calibState').textContent = 'Quieto, te estoy midiendo';
        $('calibState').classList.add('ok');
    }
    calib.samples.push(m);

    const elapsed = now - calib.startedAt;
    const p = Math.min(1, elapsed / CALIB_MS);
    $('calibFg').style.strokeDashoffset = String(327 * (1 - p));
    $('calibCount').textContent = String(Math.ceil((CALIB_MS - elapsed) / 1000) || 1);

    if (elapsed >= CALIB_MS) {
        const avg = (key) => calib.samples.reduce((t, s) => t + s[key], 0) / calib.samples.length;
        pose.base = {
            shoulderY: avg('shoulderY'),
            hipY: avg('hipY'),
            centerX: avg('centerX'),
            shoulderW: avg('shoulderW'),
            torso: avg('torso')
        };
        pose.filtros = null;
        pose.rachaSubida = 0;
        pose.velPico = 0;
        pose.fase = 'juego';
        camBox.classList.remove('grande');
        pose.prev = null;
        startGame();
    }
}

function showError(title, note) {
    $('errorTitle').textContent = title;
    $('errorNote').textContent = note;
    showPanel('error');
}

async function startWithCamera() {
    if (!cameraSupported()) {
        showError('Aquí no puedo usar la cámara',
            'El navegador no permite acceder a la cámara en esta página. Si has abierto el enlace dentro de otra app (Instagram, TikTok…), ábrelo en Chrome o Safari.');
        return;
    }

    input.mode = 'pose';
    showPanel('loading');

    try {
        $('loadingTitle').textContent = 'Pidiendo la cámara…';
        await openCamera();
    } catch (err) {
        const map = {
            NotAllowedError: 'Has denegado el permiso. Puedes volver a darlo desde el candado de la barra de direcciones.',
            NotFoundError: 'No hemos encontrado ninguna cámara conectada.',
            NotReadableError: 'La cámara la está usando otro programa. Ciérralo y vuelve a intentarlo.'
        };
        showError('No se pudo abrir la cámara', map[err.name] || 'Ha fallado el acceso a la cámara. Prueba con el teclado.');
        return;
    }

    camBox.hidden = false;

    try {
        $('loadingTitle').textContent = 'Cargando el detector…';
        $('loadingNote').textContent = 'Son unos megas la primera vez y tarda unos segundos en arrancar. Después queda en caché.';
        await loadDetector();
    } catch {
        showError('No se pudo cargar el detector',
            'No hemos podido descargar el modelo de detección. Revisa la conexión o juega con el teclado.');
        return;
    }

    pose.base = null;
    pose.running = true;
    pose.fase = 'preview';
    camBox.classList.add('grande');
    $('btnListo').disabled = true;
    $('calibFg').style.strokeDashoffset = '327';
    showPanel('preview');
    requestAnimationFrame(detectLoop);
}

function startWithKeys() {
    input.mode = 'keys';
    startGame();
}

function stopCamera() {
    pose.running = false;
    if (pose.stream) {
        pose.stream.getTracks().forEach((t) => t.stop());
        pose.stream = null;
    }
}

// ================= Uno contra uno =================
/**
 * El duelo por encima del juego de siempre. No cambia ni una regla: los dos
 * corren la misma pista —la semilla llega del servidor— y gana quien aguante
 * más. Lo único que se añade a la partida es el marcador del rival.
 */
const duelo = {
    activo: false,
    id: null,
    canal: null,
    rivalTiempo: 0,
    rivalVivo: true,
    miTiempo: 0,
    guardado: false
};

async function pedirDuelo() {
    initAudio();
    sfx.boton();
    let D;
    try {
        D = await import('./duelo.js');
    } catch {
        showError('No se pudo cargar el modo duelo', 'Revisa la conexión e inténtalo otra vez.');
        return;
    }
    const sesion = await D.sesionActual().catch(() => null);
    if (!sesion) { showPanel('login'); $('loginEmail').focus(); return; }
    entrarEnCola(D);
}

async function entrarEnCola(D) {
    showPanel('cola');
    $('colaTitulo').textContent = 'Buscando rival…';
    try {
        const encontrado = await D.buscarRival((txt) => { $('colaTitulo').textContent = txt; });
        if (!encontrado) {
            $('colaTitulo').textContent = 'No ha entrado nadie';
            $('colaNota').textContent = 'Prueba en un rato, o juega tú solo mientras tanto.';
            return;
        }
        arrancarDuelo(D, encontrado.duelo);
    } catch (e) {
        showError('No se pudo buscar rival', e.message || 'Inténtalo de nuevo.');
    }
}

async function arrancarDuelo(D, info) {
    duelo.activo = true;
    duelo.id = info.id;
    duelo.rivalTiempo = 0;
    duelo.rivalVivo = true;
    duelo.guardado = false;

    duelo.canal = await D.abrirCanal(info.id, (p) => {
        duelo.rivalTiempo = p.t || 0;
        duelo.rivalVivo = !!p.vivo;
    });

    $('rival').hidden = false;
    pintarRival();

    // LA CLAVE: los dos reciben la misma semilla, así que corren la pista
    // idéntica. Sin esto la comparación no valdría nada.
    jugarConSemilla(info.semilla);
    input.mode = 'keys';
    startGame();
}

function pintarRival() {
    $('rivalTiempo').textContent = formatoTiempo(duelo.rivalTiempo);
    $('rivalEstado').textContent = duelo.rivalVivo ? 'corriendo' : 'ha caído';
    $('rival').classList.toggle('caido', !duelo.rivalVivo);
}

/** Cierra el duelo: guarda tu tiempo y enseña quién ha ganado. */
async function terminarDuelo(segundos) {
    duelo.miTiempo = segundos;
    if (duelo.guardado) return;
    duelo.guardado = true;

    try {
        const D = await import('./duelo.js');
        await D.guardarTiempo(duelo.id, segundos);
    } catch { /* si falla el guardado, el duelo se resuelve igual en pantalla */ }

    // Si el rival sigue vivo hay que esperarle: aún puede pasarte
    if (duelo.rivalVivo) {
        $('dueloTitulo').textContent = 'Has caído';
        $('dueloMarcador').innerHTML = `Tú <strong>${formatoTiempo(segundos)}</strong>`;
        $('dueloNota').textContent = 'Tu rival sigue corriendo. A ver hasta dónde llega.';
        showPanel('duelo');
        esperarAlRival(segundos);
        return;
    }
    resolverDuelo(segundos);
}

function esperarAlRival(miTiempo) {
    const hasta = Date.now() + 90000;
    const reloj = setInterval(() => {
        pintarRival();
        $('dueloNota').textContent = `Tu rival va por ${formatoTiempo(duelo.rivalTiempo)}…`;
        if (!duelo.rivalVivo || Date.now() > hasta) {
            clearInterval(reloj);
            resolverDuelo(miTiempo);
        }
    }, 400);
}

function resolverDuelo(miTiempo) {
    const suyo = duelo.rivalTiempo;
    const gano = miTiempo > suyo;
    const empate = Math.abs(miTiempo - suyo) < 0.5;

    $('dueloTitulo').textContent = empate ? '¡Empate!' : (gano ? '¡Ganaste!' : 'Esta vez no');
    $('dueloMarcador').innerHTML =
        `Tú <strong>${formatoTiempo(miTiempo)}</strong> · Rival <strong>${formatoTiempo(suyo)}</strong>`;
    $('dueloNota').textContent = empate
        ? 'Habéis aguantado prácticamente lo mismo.'
        : (gano
            ? `Le has sacado ${formatoTiempo(Math.abs(miTiempo - suyo))}.`
            : `Te ha sacado ${formatoTiempo(Math.abs(suyo - miTiempo))}. La próxima.`);
    if (gano && !empate) sfx.record();
    showPanel('duelo');
    cerrarDuelo();
}

function cerrarDuelo() {
    duelo.activo = false;
    if (duelo.canal) { duelo.canal.cerrar(); duelo.canal = null; }
    $('rival').hidden = true;
}

// ================= Arranque =================
/** El audio solo puede nacer dentro de un clic: lo encendemos en el primero. */
function conAudio(fn) {
    return (...args) => {
        initAudio();
        sfx.boton();
        return fn(...args);
    };
}

$('btnCam').addEventListener('click', conAudio(startWithCamera));
$('btnKeys').addEventListener('click', conAudio(startWithKeys));
$('btnErrorKeys').addEventListener('click', conAudio(() => {
    stopCamera();
    camBox.hidden = true;
    startWithKeys();
}));
$('btnAgain').addEventListener('click', conAudio(() => {
    if (input.mode === 'pose' && pose.base) startGame();
    else if (input.mode === 'pose') startWithCamera();
    else startWithKeys();
}));
$('btnResume').addEventListener('click', conAudio(() => togglePause(false)));
$('btnQuit').addEventListener('click', conAudio(() => {
    game.paused = false;
    game.running = false;
    showPanel('start');
    hud.hidden = true;
}));
$('btnPause').addEventListener('click', () => togglePause());

// De la previsualización a calibrar: tú decides cuándo estás listo
$('btnListo').addEventListener('click', conAudio(() => {
    pose.fase = 'juego';
    camBox.classList.remove('grande');
    showPanel('calib');
}));
$('btnPreviewSalir').addEventListener('click', conAudio(() => {
    pose.fase = 'juego';
    camBox.classList.remove('grande');
    stopCamera();
    camBox.hidden = true;
    showPanel('start');
}));

/**
 * Pantalla completa. En el móvil es la diferencia entre jugar y adivinar:
 * quita la barra del navegador y el escenario se queda con toda la pantalla.
 */
function pantallaCompleta() {
    const el = stage;
    if (document.fullscreenElement) {
        document.exitFullscreen?.();
    } else if (el.requestFullscreen) {
        el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    } else if (el.webkitRequestFullscreen) {
        el.webkitRequestFullscreen();   // Safari de iPhone no lo tiene, aviso aparte
    }
}
$('btnPantalla').addEventListener('click', pantallaCompleta);
document.addEventListener('fullscreenchange', () => {
    $('btnPantalla').textContent = document.fullscreenElement ? '⤡' : '⛶';
    // El observador recoloca el lienzo solo, pero forzamos por si acaso
    resizeCanvas();
    if (!game.running) renderIdle();
});

$('btnDuelo').addEventListener('click', pedirDuelo);
$('btnLoginVolver').addEventListener('click', conAudio(() => showPanel('start')));
$('btnDueloSalir').addEventListener('click', conAudio(() => { cerrarDuelo(); showPanel('start'); }));
$('btnOtroDuelo').addEventListener('click', conAudio(async () => {
    cerrarDuelo();
    const D = await import('./duelo.js');
    entrarEnCola(D);
}));
$('btnCancelarCola').addEventListener('click', conAudio(async () => {
    const D = await import('./duelo.js');
    await D.cancelarBusqueda();
    showPanel('start');
}));
$('formLogin').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('loginError');
    err.hidden = true;
    $('btnEntrar').disabled = true;
    try {
        const D = await import('./duelo.js');
        await D.iniciarSesion($('loginEmail').value, $('loginPass').value);
        $('loginPass').value = '';
        entrarEnCola(D);
    } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
    } finally {
        $('btnEntrar').disabled = false;
    }
});

const CALIDAD_KEY = 'gymspeak-runner-calidad';
function aplicarCalidad(alta) {
    setCalidad(alta);
    $('btnCalidad').textContent = alta ? '✦' : '◦';
    $('btnCalidad').title = alta ? 'Gráficos: altos' : 'Gráficos: ligeros';
    try { localStorage.setItem(CALIDAD_KEY, alta ? '1' : '0'); } catch { /* da igual */ }
}
$('btnCalidad').addEventListener('click', () => {
    let alta = true;
    try { alta = localStorage.getItem(CALIDAD_KEY) !== '0'; } catch { /* da igual */ }
    aplicarCalidad(!alta);
    if (!game.running) renderIdle();
});

$('btnSound').addEventListener('click', () => {
    initAudio();
    const on = toggleAudio();
    $('btnSound').textContent = on ? '🔊' : '🔇';
    $('btnSound').setAttribute('aria-label', on ? 'Silenciar' : 'Activar sonido');
    if (on) sfx.boton();
});

// Un observador del escenario en vez de escuchar el 'resize' de la ventana:
// se entera igual de girar el móvil, pero además del primer momento en que el
// elemento tiene tamaño de verdad, que es justo lo que fallaba.
if (window.ResizeObserver) {
    new ResizeObserver(() => {
        resizeCanvas();
        if (!game.running) renderIdle();
    }).observe(stage);
} else {
    window.addEventListener('resize', () => {
        resizeCanvas();
        if (!game.running) renderIdle();
    });
}
window.addEventListener('pagehide', stopCamera);


if (!cameraSupported()) {
    $('btnCam').disabled = true;
    $('startNote').textContent = inAppBrowser()
        ? 'Estás dentro del navegador de otra app y no deja usar la cámara. Abre esta página en Chrome o Safari, o juega ahora con el teclado.'
        : 'Tu navegador no permite usar la cámara aquí. Puedes jugar con el teclado.';
} else if (inAppBrowser()) {
    $('startNote').textContent = 'Ojo: estás dentro del navegador de otra app y la cámara puede fallar. Si no arranca, abre la página en Chrome o Safari.';
}

// Si el móvil se bloquea o cambias de app en plena partida, mejor pausar
document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.running) togglePause(true);
});

initRender(canvas);
resizeCanvas();
renderIdle();
paintRecord();
$('btnSound').textContent = audioActivo() ? '🔊' : '🔇';
(() => {
    let alta = true;
    try { alta = localStorage.getItem(CALIDAD_KEY) !== '0'; } catch { /* da igual */ }
    aplicarCalidad(alta);
})();
