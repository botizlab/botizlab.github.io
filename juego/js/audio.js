/**
 * Sonido del GymSpeak Runner.
 *
 * Nada de archivos: todo se sintetiza con WebAudio, así que pesa cero y no hay
 * descargas que esperar. El contexto se crea con el primer clic del usuario,
 * que es lo que exigen los navegadores para dejar sonar nada.
 */

let ctx = null;
let master = null;
let activo = true;

export function initAudio() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = activo ? 0.32 : 0;
    master.connect(ctx.destination);
}

export function toggleAudio() {
    activo = !activo;
    if (master) master.gain.value = activo ? 0.32 : 0;
    return activo;
}

export const audioActivo = () => activo;

/** Tono simple con envolvente: el ladrillo con el que se construye todo. */
function tono({ freq, freq2, dur = 0.14, tipo = 'sine', vol = 1, retraso = 0 }) {
    if (!ctx || !activo) return;
    const t0 = ctx.currentTime + retraso;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = tipo;
    osc.frequency.setValueAtTime(freq, t0);
    if (freq2) osc.frequency.exponentialRampToValueAtTime(freq2, t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
}

/** Golpe seco: ruido filtrado, como un disco cayendo al suelo. */
function golpe() {
    if (!ctx || !activo) return;
    const dur = 0.3;
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2.5);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filtro = ctx.createBiquadFilter();
    filtro.type = 'lowpass';
    filtro.frequency.value = 420;
    const g = ctx.createGain();
    g.gain.value = 0.9;
    src.connect(filtro);
    filtro.connect(g);
    g.connect(master);
    src.start();
}

export const sfx = {
    salto: () => tono({ freq: 320, freq2: 640, dur: 0.13, tipo: 'triangle', vol: 0.5 }),
    aterrizaje: () => tono({ freq: 180, freq2: 90, dur: 0.1, tipo: 'sine', vol: 0.35 }),
    // El disco sube de tono con el multiplicador: premia encadenar
    disco: (mult = 1) => tono({
        freq: 780 + Math.min(4, mult - 1) * 130,
        freq2: 1180 + Math.min(4, mult - 1) * 180,
        dur: 0.1, tipo: 'square', vol: 0.28
    }),
    golpe,
    boton: () => tono({ freq: 440, dur: 0.06, tipo: 'sine', vol: 0.3 }),
    // Dos sonidos bien distintos: la que cae hace un golpe grave, la que sube
    // hace un clac metálico agudo. Con oírlo ya sabes qué toca hacer.
    // Cada peldaño suena un poco más agudo que el anterior: se oye que encadenas
    escalon: (seguidos = 1) => tono({
        freq: 520 + Math.min(7, seguidos) * 65,
        dur: 0.07, tipo: 'triangle', vol: 0.2
    }),
    // Campanita que sube con los encadenados: se oye que estás en racha
    perfecto: (seguidos = 1) => tono({
        freq: 880 + Math.min(6, seguidos) * 90,
        freq2: 1320 + Math.min(6, seguidos) * 120,
        dur: 0.12, tipo: 'triangle', vol: 0.3
    }),
    maquinaBaja: () => tono({ freq: 150, freq2: 55, dur: 0.26, tipo: 'square', vol: 0.42 }),
    maquinaSube: () => tono({ freq: 620, freq2: 1150, dur: 0.16, tipo: 'square', vol: 0.26 }),
    record: () => {
        [523, 659, 784, 1046].forEach((f, i) => {
            tono({ freq: f, dur: 0.18, tipo: 'triangle', vol: 0.4, retraso: i * 0.09 });
        });
    }
};
