/**
 * Banco de patrones del GymSpeak Runner.
 *
 * La pista se construye con tramos diseñados a mano y barajados: cada uno tiene
 * una intención (respirar, encadenar, elegir, castigar la avaricia) y siempre
 * deja una salida posible.
 *
 * Elementos, todos en clave de gimnasio:
 *   barra     → barra con discos en el suelo: hay que SALTAR
 *   dominadas → barra de dominadas: hay que AGACHARSE
 *   banco     → banco de press que tapa el carril: hay que CAMBIARSE
 *   saco      → saco de boxeo colgado que OSCILA entre los dos carriles;
 *               se esquiva cambiándose al carril libre o pasando por debajo
 *   prensa    → barra de máquina que baja hasta EL SUELO: hay que SALTAR
 *   polea     → barra de máquina que se queda a la ALTURA DEL PECHO: AGACHARSE
 *   cuerda    → comba que barre los DOS carriles a ras de suelo con su ritmo;
 *               cambiarse no sirve, o saltas cuando toca o te la comes
 *   balon     → balón medicinal que RUEDA hacia ti cambiando de carril por el
 *               camino; se salta o te apartas al carril que deja libre
 *   escalon   → peldaño de escalera de agilidad: no hace nada, es suelo pintado
 *
 * dz = distancia dentro del tramo (0 es el principio). len = largo del tramo.
 *
 * DOS REGLAS que no se pueden romper:
 *
 * 1. Nunca los dos carriles bloqueados a la vez: siempre tiene que haber salida.
 * 2. Dos obstáculos seguidos en el mismo carril tienen que estar separados al
 *    menos SEPARACION_MINIMA. Un salto cubre 0,30 de distancia, así que por
 *    debajo de eso aterrizas encima del siguiente y no hay reflejos que valgan.
 *    Si además el segundo obliga a agacharse, hace falta más margen todavía:
 *    caer y ponerse en cuclillas con el cuerpo no es instantáneo.
 */
export const SEPARACION_MINIMA = 0.50;

// ================= Obstáculos con vida propia =================
// El saco, la prensa, la comba y el balón se mueven solos. Estas funciones son
// la ÚNICA fuente de verdad: las usan igual el que dibuja y el que decide si te
// has chocado, para que nunca puedas ver una cosa y chocarte con otra.

const SACO_PERIODO = 2400;      // ms que tarda en ir y volver

/** Posición del saco en unidades de carril, de -0.5 a 0.5. */
export const sacoU = (o, now) =>
    0.52 * Math.sin(((now + o.fase) / SACO_PERIODO) * Math.PI * 2);

/**
 * ¿El saco te pilla a ti?
 *
 * Antes se miraba el SIGNO de su posición, así que el saco "ocupaba" un carril
 * entero incluso cuando estaba cruzando por el medio, y bastaba con que pasara
 * de 0 por un pelo para que te diera aunque lo vieras en el otro lado. Ahora
 * solo golpea si está de verdad encima de tu carril; por el centro no golpea a
 * nadie, que es justo lo que se ve.
 */
const SACO_RADIO = 0.30;
export const sacoGolpea = (o, now, lane) =>
    Math.abs(sacoU(o, now) - lane * 0.5) < SACO_RADIO;

/**
 * Altura de la barra de las máquinas, en unidades de personaje.
 *
 * Cada máquina hace UN SOLO movimiento, y la DIRECCIÓN es la señal. No hay que
 * fijarse en dónde acaba: se ve desde lejos hacia dónde va.
 *
 *   prensa → sale ARRIBA del todo y BAJA hasta el suelo  → salta
 *   polea  → sale PEGADA AL SUELO y SUBE hasta el pecho  → por debajo
 *
 * El recorrido es largo a propósito (más de un cuerpo y medio) para que el
 * movimiento cante. Y va por DISTANCIA, no por reloj: cuando te llega lleva un
 * buen rato quieta, así que nunca te cambia el gesto en el último momento.
 */
const BARRA_SUELO = 0.03;
const BARRA_TECHO = 2.20;
const BARRA_PECHO = 0.78;
// El movimiento NO pasa nada más aparecer: la máquina llega con la barra
// parada en su sitio de salida y la mueve cuando ya está cerca y GRANDE. Antes
// se movía en el horizonte, cuando era un punto, y para cuando la mirabas ya
// estaba quieta: por eso las dos parecían la misma y te equivocabas de gesto.
const MOV_INICIO = 0.78;
export const MOV_FIN = 0.55;

/** Dónde acaba la barra de cada máquina. El render lo marca desde el principio. */
export const barraDestino = (tipo) => (tipo === 'prensa' ? BARRA_SUELO : BARRA_PECHO);

export function barraMovilAltura(tipo, z) {
    const t = Math.min(1, Math.max(0, (MOV_INICIO - z) / (MOV_INICIO - MOV_FIN)));
    // Curva agresiva: arranca lento y se desploma. Es un golpe, no un paseo.
    const suave = t * t * t * (t * (t * 6 - 15) + 10);
    return tipo === 'prensa'
        ? BARRA_TECHO + (BARRA_SUELO - BARRA_TECHO) * suave   // cae a plomo
        : BARRA_SUELO + (BARRA_PECHO - BARRA_SUELO) * suave;  // se dispara arriba
}

/** true mientras la barra está en pleno movimiento: el render lo exagera. */
export const barraEnMovimiento = (z) => z < MOV_INICIO + 0.02 && z > MOV_FIN - 0.04;

/** Hasta dónde llega el bastidor de la máquina. */
export const BARRA_ALTURA_MAX = BARRA_TECHO + 0.12;

/**
 * Altura de la comba, en unidades de personaje.
 *
 * Antes iba por RELOJ: subía y bajaba a su ritmo, y tenías que adivinar si al
 * llegar tú estaría abajo o arriba. Era imposible de leer — no sabías ni qué
 * hacer ni cuándo. Ahora va por DISTANCIA, igual que las máquinas: viene alta,
 * baja hasta el suelo cuando ya la tienes encima, y se queda ahí.
 *
 * Con eso la regla es una sola y no hay dudas: la comba acaba SIEMPRE en el
 * suelo, y como ocupa los dos carriles, o la saltas o te la comes.
 */
export function cuerdaAltura(o, z) {
    const t = Math.min(1, Math.max(0, (MOV_INICIO - z) / (MOV_INICIO - MOV_FIN)));
    const suave = t * t * t * (t * (t * 6 - 15) + 10);
    return 1.60 + (0.05 - 1.60) * suave;
}

/** true cuando la comba ya está barriendo el suelo. */
export const cuerdaAbajo = (z) => z <= MOV_FIN;

/**
 * El balón rueda de un carril al otro según se acerca, así que su posición
 * depende de la DISTANCIA y no del reloj: se ve venir y se puede anticipar.
 */
export function balonU(o, z) {
    const avance = Math.min(1, Math.max(0, (1.25 - z) / 1.05));
    const suave = avance * avance * (3 - 2 * avance);
    return (o.lane * 0.5) * (1 - suave) + (o.destino * 0.5) * suave;
}

/**
 * Generador con semilla (mulberry32).
 *
 * La pista NO se sortea con Math.random: se sortea con esto. Así, dos personas
 * con la misma semilla corren exactamente el mismo recorrido, que es la única
 * forma de que un uno contra uno sea justo — si a uno le toca una tirada suave
 * y al otro una brutal, la comparación no vale nada.
 *
 * De regalo, una partida se puede reproducir entera sabiendo su semilla.
 */
let _estado = 123456789;

export function setSemilla(n) {
    _estado = (n >>> 0) || 1;
}

export function nuevaSemilla() {
    const n = (Math.random() * 4294967296) >>> 0;
    setSemilla(n);
    return n;
}

export function azar() {
    _estado |= 0;
    _estado = (_estado + 0x6D2B79F5) | 0;
    let t = Math.imul(_estado ^ (_estado >>> 15), 1 | _estado);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const P = (nombre, len, dificultad, items) => ({ nombre, len, dificultad, items });

export const PATTERNS = [
    // ============ Nivel 1: un gesto cada vez, con aire de sobra ============
    P('barra suelta', 0.55, 1, [
        { t: 'barra', lane: -1, dz: 0 }
    ]),
    P('barra suelta espejo', 0.55, 1, [
        { t: 'barra', lane: 1, dz: 0 }
    ]),
    P('bajo la barra', 0.5, 1, [
        { t: 'dominadas', lane: -1, dz: 0 },
        { t: 'dominadas', lane: 1, dz: 0 }
    ]),
    P('primer banco', 0.55, 1, [
        { t: 'banco', lane: -1, dz: 0 }
    ]),
    P('primer banco espejo', 0.55, 1, [
        { t: 'banco', lane: 1, dz: 0 }
    ]),
    P('escalera de agilidad', 0.6, 1, [
        { t: 'escalon', lane: -1, dz: 0 },
        { t: 'escalon', lane: -1, dz: 0.08 },
        { t: 'escalon', lane: -1, dz: 0.16 },
        { t: 'escalon', lane: -1, dz: 0.24 },
        { t: 'escalon', lane: -1, dz: 0.32 }
    ]),
    P('escalera de agilidad espejo', 0.6, 1, [
        { t: 'escalon', lane: 1, dz: 0 },
        { t: 'escalon', lane: 1, dz: 0.08 },
        { t: 'escalon', lane: 1, dz: 0.16 },
        { t: 'escalon', lane: 1, dz: 0.24 },
        { t: 'escalon', lane: 1, dz: 0.32 }
    ]),
    // Un respiro de verdad: marca el ritmo, como un silencio en una canción
    P('respiro', 0.5, 1, []),

    // ============ Nivel 2: dos gestos, o una elección ============
    P('doble barra', 0.95, 2, [
        { t: 'barra', lane: -1, dz: 0 },
        { t: 'barra', lane: 1, dz: 0 },
        { t: 'barra', lane: -1, dz: 0.56 },
        { t: 'barra', lane: 1, dz: 0.56 }
    ]),
    P('la polea', 0.6, 2, [
        { t: 'polea', lane: -1, dz: 0 }
    ]),
    P('la polea espejo', 0.6, 2, [
        { t: 'polea', lane: 1, dz: 0 }
    ]),
    // Las dos máquinas juntas: bajan igual y paran distinto. Hay que mirar.
    P('prensa y polea', 0.95, 2, [
        { t: 'prensa', lane: -1, dz: 0 },
        { t: 'polea', lane: 1, dz: 0 }
    ]),
    P('prensa y polea espejo', 0.95, 2, [
        { t: 'polea', lane: -1, dz: 0 },
        { t: 'prensa', lane: 1, dz: 0 }
    ]),
    P('el saco', 0.65, 2, [
        { t: 'saco', lane: 0, dz: 0 }
    ]),
    P('la comba', 0.6, 2, [
        { t: 'cuerda', lane: 0, dz: 0 }
    ]),
    P('balón rodando', 0.65, 2, [
        { t: 'balon', lane: -1, destino: 1, dz: 0 }
    ]),
    P('balón rodando espejo', 0.65, 2, [
        { t: 'balon', lane: 1, destino: -1, dz: 0 }
    ]),
    P('cambio y salto', 0.9, 2, [
        { t: 'banco', lane: -1, dz: 0 },
        { t: 'barra', lane: -1, dz: 0.52 },
        { t: 'barra', lane: 1, dz: 0.52 }
    ]),
    P('cambio y salto espejo', 0.9, 2, [
        { t: 'banco', lane: 1, dz: 0 },
        { t: 'barra', lane: -1, dz: 0.52 },
        { t: 'barra', lane: 1, dz: 0.52 }
    ]),
    P('barra y escalera', 0.85, 2, [
        { t: 'barra', lane: -1, dz: 0 },
        { t: 'escalon', lane: 1, dz: 0.10 },
        { t: 'escalon', lane: 1, dz: 0.18 },
        { t: 'escalon', lane: 1, dz: 0.26 }
    ]),
    P('barra y escalera espejo', 0.85, 2, [
        { t: 'barra', lane: 1, dz: 0 },
        { t: 'escalon', lane: -1, dz: 0.10 },
        { t: 'escalon', lane: -1, dz: 0.18 },
        { t: 'escalon', lane: -1, dz: 0.26 }
    ]),
    P('dos bancos', 0.95, 2, [
        { t: 'banco', lane: -1, dz: 0 },
        { t: 'banco', lane: 1, dz: 0.55 }
    ]),

    // ============ Nivel 3: cadenas largas y cosas en movimiento ============
    P('zigzag', 1.15, 3, [
        { t: 'banco', lane: -1, dz: 0 },
        { t: 'banco', lane: 1, dz: 0.40 },
        { t: 'banco', lane: -1, dz: 0.80 }
    ]),
    P('salta y agacha', 1.2, 3, [
        { t: 'barra', lane: -1, dz: 0 },
        { t: 'barra', lane: 1, dz: 0 },
        { t: 'dominadas', lane: -1, dz: 0.68 },
        { t: 'dominadas', lane: 1, dz: 0.68 }
    ]),
    P('agacha y salta', 1.2, 3, [
        { t: 'dominadas', lane: -1, dz: 0 },
        { t: 'dominadas', lane: 1, dz: 0 },
        { t: 'barra', lane: -1, dz: 0.62 },
        { t: 'barra', lane: 1, dz: 0.62 }
    ]),
    P('pasillo bajo', 0.85, 3, [
        { t: 'dominadas', lane: -1, dz: 0 },
        { t: 'dominadas', lane: 1, dz: 0 },
        { t: 'dominadas', lane: -1, dz: 0.18 },
        { t: 'dominadas', lane: 1, dz: 0.18 }
    ]),
    P('barra y polea', 1.0, 3, [
        { t: 'barra', lane: -1, dz: 0 },
        { t: 'barra', lane: 1, dz: 0 },
        { t: 'polea', lane: -1, dz: 0.64 },
        { t: 'polea', lane: 1, dz: 0.64 }
    ]),
    P('polea y prensa seguidas', 1.15, 3, [
        { t: 'polea', lane: -1, dz: 0 },
        { t: 'polea', lane: 1, dz: 0 },
        { t: 'prensa', lane: -1, dz: 0.62 },
        { t: 'prensa', lane: 1, dz: 0.62 }
    ]),
    P('dos sacos', 1.05, 3, [
        { t: 'saco', lane: 0, dz: 0 },
        { t: 'saco', lane: 0, dz: 0.55 }
    ]),
    P('sala de máquinas', 1.15, 3, [
        { t: 'prensa', lane: -1, dz: 0 },
        { t: 'prensa', lane: 1, dz: 0.30 },
        { t: 'saco', lane: 0, dz: 0.72 }
    ]),
    P('doble comba', 1.0, 3, [
        { t: 'cuerda', lane: 0, dz: 0 },
        { t: 'cuerda', lane: 0, dz: 0.55 }
    ]),
    P('comba y banco', 1.0, 3, [
        { t: 'cuerda', lane: 0, dz: 0 },
        { t: 'banco', lane: -1, dz: 0.58 }
    ]),
    P('comba y banco espejo', 1.0, 3, [
        { t: 'cuerda', lane: 0, dz: 0 },
        { t: 'banco', lane: 1, dz: 0.58 }
    ]),
    P('balones cruzados', 1.15, 3, [
        { t: 'balon', lane: -1, destino: 1, dz: 0 },
        { t: 'balon', lane: 1, destino: -1, dz: 0.60 }
    ]),
    P('balón y prensa', 1.05, 3, [
        { t: 'balon', lane: 1, destino: -1, dz: 0 },
        { t: 'prensa', lane: -1, dz: 0.58 }
    ]),
    P('circuito completo', 1.5, 3, [
        { t: 'barra', lane: -1, dz: 0 },
        { t: 'barra', lane: 1, dz: 0 },
        { t: 'banco', lane: -1, dz: 0.55 },
        { t: 'dominadas', lane: -1, dz: 1.10 },
        { t: 'dominadas', lane: 1, dz: 1.10 }
    ]),
    P('circuito completo espejo', 1.5, 3, [
        { t: 'barra', lane: -1, dz: 0 },
        { t: 'barra', lane: 1, dz: 0 },
        { t: 'banco', lane: 1, dz: 0.55 },
        { t: 'dominadas', lane: -1, dz: 1.10 },
        { t: 'dominadas', lane: 1, dz: 1.10 }
    ]),
    P('el gimnasio entero', 1.75, 3, [
        { t: 'cuerda', lane: 0, dz: 0 },
        { t: 'polea', lane: -1, dz: 0.58 },
        { t: 'polea', lane: 1, dz: 0.58 },
        { t: 'saco', lane: 0, dz: 1.15 }
    ])
];

/**
 * Elige un tramo acorde a la velocidad, sin repetir el anterior.
 * Al principio solo salen los fáciles; a partir de cierta velocidad entra todo.
 */
export function pickPattern(speed, ultimo) {
    const techo = speed < 0.58 ? 1 : speed < 0.78 ? 2 : 3;
    const posibles = PATTERNS.filter((p) => p.dificultad <= techo && p !== ultimo);
    return posibles[Math.floor(azar() * posibles.length)] || PATTERNS[0];
}
