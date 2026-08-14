/**
 * Capa visual del GymSpeak Runner.
 *
 * Escenario: un gimnasio de noche. El jugador corre sobre dos cintas puestas
 * en paralelo y el material del gimnasio pasa por los lados.
 *
 * Todo es canvas 2D, sin librerías. El aspecto sale de: capas pre-renderizadas
 * (la pared del fondo se pinta una vez, no 60 veces por segundo), resplandor
 * con sprites aditivos en lugar de shadowBlur (que es carísimo), y colores
 * SÓLIDOS — el material es metal y goma, no cristal.
 */

import {
    sacoU, barraMovilAltura, barraEnMovimiento,
    BARRA_ALTURA_MAX, cuerdaAltura, cuerdaAbajo, balonU
} from './patterns.js';

// ================= Proyección =================
const DEPTH = 3.2;
// En apaisado y en vertical la escena no se puede componer igual: con la
// pantalla alta y estrecha hace falta subir el horizonte y bajar al corredor,
// o la pista se queda en una franja en medio con hueco muerto arriba y abajo.
let HORIZON = 0.30;
let GROUND = 0.86;
const SPREAD = 0.42;   // separación entre las dos cintas
const SIZE = 0.26;     // unidad de tamaño de personaje y obstáculos

export const laneU = (lane) => lane * 0.5;

let ctx = null;
let W = 900;
let H = 560;
let camX = 0;

const scaleAt = (z) => 1 / (1 + z * DEPTH);
const yAt = (z) => H * HORIZON + (H * GROUND - H * HORIZON) * scaleAt(z);
const xAt = (u, z) => W / 2 + (u - camX) * W * SPREAD * scaleAt(z);
const unitAt = (z) => W * SIZE * scaleAt(z);

// ================= Paleta =================
const COL = {
    cian: [34, 224, 255],
    verde: [52, 210, 123],
    ambar: [255, 176, 58],
    rojo: [255, 77, 94],
    acero: [126, 138, 156],
    blanco: [234, 246, 255]
};
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
/** Versión sólida de un color, aclarada u oscurecida. Nada de alfa. */
const tono = (c, f) => `rgb(${Math.min(255, c[0] * f | 0)},${Math.min(255, c[1] * f | 0)},${Math.min(255, c[2] * f | 0)})`;

// ================= Capas pre-renderizadas =================
const layers = {};
const glows = {};

function offscreen(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
}

function buildGlow(color) {
    const size = 128;
    const c = offscreen(size, size);
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, rgba(color, 0.85));
    grad.addColorStop(0.35, rgba(color, 0.26));
    grad.addColorStop(1, rgba(color, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    return c;
}

// ================= Zonas del gimnasio =================
/**
 * Correr siempre por la misma sala cansa, así que el gimnasio tiene zonas y se
 * cambia de una a otra cada cierto tiempo. Cada zona trae su propia pared, su
 * luz, su color de marca y su material de fondo. El cambio se hace fundiendo la
 * pared vieja con la nueva, y de paso las barandillas cambian de color.
 *
 * Cada pared se pinta UNA vez a un lienzo oculto; el coste por fotograma es
 * estampar una imagen, cambie o no cambie de zona.
 */
export const ZONAS = [
    { nombre: 'Sala de pesas', acento: [52, 210, 123], luz: '#fff6dd', pared: ['#0b0d12', '#15181f', '#1b1f28'], estructura: [126,138,156], detalle: [30,34,42] },
    { nombre: 'Zona de cardio', acento: [34, 224, 255], luz: '#dceeff', pared: ['#080d14', '#101a24', '#16232f'], estructura: [142,154,172], detalle: [38,44,54] },
    { nombre: 'Box de crossfit', acento: [255, 176, 58], luz: '#ffe6c4', pared: ['#120d08', '#1e1710', '#282017'], estructura: [118,120,116], detalle: [26,26,28] },
    { nombre: 'Zona de posing', acento: [196, 208, 228], luz: '#f2f6ff', pared: ['#0d0f14', '#181c24', '#232833'], estructura: [170,180,198], detalle: [76,56,38] },
    // A partir de aquí la cinta se sale del gimnasio
    { nombre: 'Pista de atletismo', acento: [255, 122, 66], luz: '#ffe0c0', pared: ['#0a0a10', '#181218', '#2a1a1a'], estructura: [150,158,170], detalle: [152,74,44] },
    { nombre: 'Piscina', acento: [64, 196, 255], luz: '#d6f2ff', pared: ['#04101c', '#0a2036', '#0f3350'], estructura: [180,198,212], detalle: [34,78,110] },
    { nombre: 'Cancha de baloncesto', acento: [255, 150, 60], luz: '#ffeccd', pared: ['#0c0a08', '#1a1510', '#2b2318'], estructura: [146,150,158], detalle: [124,86,46] },
    { nombre: 'Ring de boxeo', acento: [255, 77, 94], luz: '#ffd9dc', pared: ['#100608', '#1c0c11', '#2a1219'], estructura: [96,100,108], detalle: [112,32,40] }
];

let zonaActual = 0;
let zonaPrevia = 0;
let fundido = 1;          // 1 = zona nueva del todo

export const zonaNombre = () => ZONAS[zonaActual].nombre;
/** Material de la sala: cada deporte tiene su metal y su acabado. */
const _mat = { estructura: null, detalle: null };
function matZona() {
    // Se reutiliza el mismo objeto: antes se creaba uno nuevo por cada
    // obstáculo y cada prop de cada fotograma, y eso son cientos por segundo
    const Z = ZONAS[zonaActual] || ZONAS[0];
    _mat.estructura = Z.estructura;
    _mat.detalle = Z.detalle;
    return _mat;
}
/** Acento en curso, mezclando durante el fundido. */
function acento() {
    const a = ZONAS[zonaPrevia].acento;
    const b = ZONAS[zonaActual].acento;
    const t = fundido;
    return [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t
    ];
}

export function setZona(i) {
    const nueva = ((i % ZONAS.length) + ZONAS.length) % ZONAS.length;
    if (nueva === zonaActual && layers.backdrop) return;
    zonaPrevia = zonaActual;
    zonaActual = nueva;
    layers.backdropPrev = layers.backdrop;
    layers.backdrop = buildBackdrop(zonaActual);
    fundido = layers.backdropPrev ? 0 : 1;
}

/** La pared de una zona con su material. Se pinta una vez y se estampa. */
function buildBackdrop(zi = 0) {
    const Z = ZONAS[zi] || ZONAS[0];
    const bw = Math.round(W * 1.25);
    const bh = Math.round(H * HORIZON + 4);
    const c = offscreen(bw, bh);
    const g = c.getContext('2d');
    const suelo = bh;

    const pared = g.createLinearGradient(0, 0, 0, bh);
    pared.addColorStop(0, Z.pared[0]);
    pared.addColorStop(0.55, Z.pared[1]);
    pared.addColorStop(1, Z.pared[2]);
    g.fillStyle = pared;
    g.fillRect(0, 0, bw, bh);

    // Juntas verticales de los paneles
    g.strokeStyle = 'rgba(0,0,0,0.45)';
    g.lineWidth = 2;
    for (let x = 0; x < bw; x += bw / 14) {
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, suelo);
        g.stroke();
    }

    // Focos del techo
    for (let i = 0; i < 7; i++) {
        const x = (i + 0.5) * (bw / 7);
        const w = bw / 22;
        const y = bh * 0.06;
        g.fillStyle = '#2a2f3a';
        g.fillRect(x - w / 2 - 3, y - 4, w + 6, bh * 0.05 + 8);
        g.fillStyle = Z.luz;
        g.fillRect(x - w / 2, y, w, bh * 0.05);
        const halo = g.createRadialGradient(x, y + bh * 0.03, 0, x, y + bh * 0.03, bh * 0.42);
        halo.addColorStop(0, 'rgba(255,245,225,0.15)');
        halo.addColorStop(1, 'rgba(255,245,225,0)');
        g.fillStyle = halo;
        g.fillRect(x - bh * 0.42, y, bh * 0.84, bh);
    }

    // Tira de neón con el color de la zona
    const [ar, ag, ab] = Z.acento;
    g.fillStyle = `rgb(${ar},${ag},${ab})`;
    g.fillRect(0, bh * 0.42, bw, 2);
    const tira = g.createLinearGradient(0, bh * 0.42 - 14, 0, bh * 0.42 + 14);
    tira.addColorStop(0, `rgba(${ar},${ag},${ab},0)`);
    tira.addColorStop(0.5, `rgba(${ar},${ag},${ab},0.30)`);
    tira.addColorStop(1, `rgba(${ar},${ag},${ab},0)`);
    g.fillStyle = tira;
    g.fillRect(0, bh * 0.42 - 14, bw, 28);

    // ---- Material contra la pared ----
    const metal = '#232936';
    const metalTop = '#39414f';
    const caja = (x, y, w, h, col = metal, top = metalTop) => {
        g.fillStyle = col;
        g.fillRect(x, y, w, h);
        g.fillStyle = top;
        g.fillRect(x, y, w, Math.max(1, h * 0.10));
    };
    const disco = (x, y, r, col = '#2b323f') => {
        g.fillStyle = col;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = '#49525f';
        g.lineWidth = 2;
        g.stroke();
    };

    // -- Sala de pesas --
    const rack = (x, e) => {
        const w = bw * 0.055 * e, h = bh * 0.62 * e, y = suelo - h;
        caja(x - w / 2, y, w * 0.14, h);
        caja(x + w / 2 - w * 0.14, y, w * 0.14, h);
        caja(x - w / 2, y, w, h * 0.06);
        caja(x - w / 2, y + h * 0.42, w, h * 0.05);
    };
    const mancuernas = (x, e) => {
        const w = bw * 0.07 * e, h = bh * 0.24 * e, y = suelo - h;
        caja(x - w / 2, y + h * 0.55, w, h * 0.45);
        for (let i = 0; i < 4; i++) disco(x - w / 2 + w * (0.18 + i * 0.21), y + h * 0.40, w * 0.07, '#3d4552');
    };
    const arbolDiscos = (x, e) => {
        const h = bh * 0.34 * e, y = suelo - h;
        caja(x - bh * 0.012, y, bh * 0.024, h);
        for (let i = 0; i < 3; i++) {
            const r = (bh * 0.05 - i * bh * 0.008) * e;
            disco(x, suelo - r - i * r * 0.5, r);
        }
    };
    const bancoPesas = (x, e) => {
        const w = bw * 0.06 * e, h = bh * 0.16 * e, y = suelo - h;
        caja(x - w / 2, y, w, h * 0.32, '#2b323f', '#454e5d');
        caja(x - w / 2 + w * 0.08, y + h * 0.32, w * 0.10, h * 0.68);
        caja(x + w / 2 - w * 0.18, y + h * 0.32, w * 0.10, h * 0.68);
    };

    // -- Zona de cardio --
    const cinta = (x, e) => {
        const w = bw * 0.07 * e, h = bh * 0.5 * e, y = suelo - h;
        caja(x - w / 2, suelo - h * 0.22, w, h * 0.22, '#1d2530', '#33404f');   // base
        caja(x - w / 2 + w * 0.06, y, w * 0.09, h * 0.8);                        // brazo izq
        caja(x + w / 2 - w * 0.15, y, w * 0.09, h * 0.8);                        // brazo der
        caja(x - w / 2, y, w, h * 0.16, '#2b3a49', '#44586b');                   // consola
    };
    const bici = (x, e) => {
        const w = bw * 0.055 * e, h = bh * 0.4 * e, y = suelo - h;
        disco(x - w * 0.3, suelo - h * 0.22, h * 0.2, '#222c38');
        caja(x - w * 0.06, y + h * 0.2, w * 0.10, h * 0.62);
        caja(x - w * 0.28, y + h * 0.15, w * 0.55, h * 0.07);
        caja(x - w * 0.30, y, w * 0.6, h * 0.09, '#2b3a49', '#44586b');
    };

    // -- Box de crossfit --
    const cajones = (x, e) => {
        const w = bw * 0.05 * e;
        for (let i = 0; i < 3; i++) {
            const lw = w * (1 - i * 0.14);
            caja(x - lw / 2, suelo - w * 0.55 * (i + 1), lw, w * 0.55, '#2a2318', '#443723');
        }
    };
    const neumaticos = (x, e) => {
        const r = bh * 0.11 * e;
        disco(x, suelo - r, r, '#1a1a1c');
        disco(x, suelo - r, r * 0.45, '#101012');
        disco(x + r * 1.9, suelo - r * 0.7, r * 0.7, '#1a1a1c');
    };
    const cuerdas = (x, e) => {
        g.strokeStyle = '#3a3020';
        g.lineWidth = Math.max(2, bh * 0.012 * e);
        for (const dx of [-bh * 0.03, bh * 0.03]) {
            g.beginPath();
            g.moveTo(x + dx, 0);
            g.lineTo(x + dx + bh * 0.02, suelo - bh * 0.02);
            g.stroke();
        }
    };

    // -- Sala de espejos --
    const espejo = (x, e) => {
        const w = bw * 0.10 * e, h = bh * 0.62 * e, y = suelo - h;
        g.fillStyle = '#1c222c';
        g.fillRect(x - w / 2, y, w, h);
        const refl = g.createLinearGradient(x - w / 2, y, x + w / 2, y + h);
        refl.addColorStop(0, 'rgba(255,255,255,0.10)');
        refl.addColorStop(0.45, 'rgba(255,255,255,0.02)');
        refl.addColorStop(1, 'rgba(255,255,255,0.07)');
        g.fillStyle = refl;
        g.fillRect(x - w / 2, y, w, h);
        g.strokeStyle = '#40495a';
        g.lineWidth = 2;
        g.strokeRect(x - w / 2, y, w, h);
    };
    const barraBallet = (x, e) => {
        const w = bw * 0.09 * e;
        caja(x - w / 2, suelo - bh * 0.20, w, bh * 0.018, '#3a4250', '#525c6e');
        caja(x - w / 2, suelo - bh * 0.20, w * 0.05, bh * 0.20);
        caja(x + w / 2 - w * 0.05, suelo - bh * 0.20, w * 0.05, bh * 0.20);
    };

    // -- Pista de atletismo --
    const gradas = (x, e) => {
        const w = bw * 0.13 * e, h = bh * 0.5 * e;
        for (let i = 0; i < 5; i++) {
            const y = suelo - h * (0.2 + i * 0.16);
            caja(x - w / 2, y, w, h * 0.06, '#20242e', '#333a47');
        }
        caja(x - w / 2, suelo - h * 0.2, w, h * 0.2, '#171b23', '#262c37');
    };
    const valla = (x, e) => {
        const w = bw * 0.035 * e, h = bh * 0.18 * e;
        caja(x - w / 2, suelo - h, w * 0.10, h);
        caja(x + w / 2 - w * 0.10, suelo - h, w * 0.10, h);
        caja(x - w / 2, suelo - h, w, h * 0.22, '#38312a', '#54483c');
    };

    // -- Piscina --
    const poyete = (x, e) => {
        const w = bw * 0.035 * e, h = bh * 0.16 * e;
        caja(x - w / 2, suelo - h, w, h * 0.55, '#1d2c3a', '#33546e');
        caja(x - w / 2 + w * 0.1, suelo - h * 0.45, w * 0.8, h * 0.45, '#152430');
    };
    const corcheras = (x, e) => {
        const w = bw * 0.12 * e;
        for (let i = 0; i < 3; i++) {
            const y = suelo - bh * (0.06 + i * 0.05) * e;
            g.strokeStyle = i % 2 ? '#2b5f80' : '#1d4761';
            g.lineWidth = Math.max(2, bh * 0.014 * e);
            g.beginPath();
            g.moveTo(x - w / 2, y);
            g.lineTo(x + w / 2, y);
            g.stroke();
        }
    };

    // -- Cancha de baloncesto --
    const canasta = (x, e) => {
        const h = bh * 0.55 * e, w = bw * 0.05 * e;
        caja(x - w * 0.06, suelo - h, w * 0.12, h);
        caja(x - w / 2, suelo - h, w, h * 0.30, '#2a2620', '#453e33');   // tablero
        g.strokeStyle = '#8c5a2b';
        g.lineWidth = Math.max(2, bh * 0.012 * e);
        g.beginPath();
        g.arc(x, suelo - h * 0.72, w * 0.18, 0, Math.PI);
        g.stroke();
    };

    // -- Ring de boxeo --
    const esquinaRing = (x, e) => {
        const w = bw * 0.11 * e, h = bh * 0.42 * e;
        caja(x - w / 2, suelo - h, w * 0.08, h, '#2a1418', '#4a2028');
        caja(x + w / 2 - w * 0.08, suelo - h, w * 0.08, h, '#2a1418', '#4a2028');
        g.lineWidth = Math.max(2, bh * 0.012 * e);
        for (let i = 0; i < 3; i++) {
            g.strokeStyle = i === 1 ? '#7a2430' : '#5c1c26';
            const y = suelo - h * (0.3 + i * 0.24);
            g.beginPath();
            g.moveTo(x - w / 2, y);
            g.lineTo(x + w / 2, y);
            g.stroke();
        }
    };

    // -- Rocódromo --
    const muroEscalada = (x, e) => {
        const w = bw * 0.11 * e, h = bh * 0.78 * e, y = suelo - h;
        caja(x - w / 2, y, w, h, '#1d1729', '#2e2440');
        const presas = ['#6f4bb0', '#a8508c', '#c46b3f', '#3f8cc4', '#c4a03f'];
        for (let i = 0; i < 11; i++) {
            const px2 = x - w / 2 + w * (0.12 + ((i * 37) % 76) / 100);
            const py2 = y + h * (0.08 + ((i * 53) % 84) / 100);
            g.fillStyle = presas[i % presas.length] || '#7a52c0';
            g.beginPath();
            g.arc(px2, py2, Math.max(2, bh * 0.011 * e), 0, Math.PI * 2);
            g.fill();
        }
    };

    const REPERTORIO = [
        [rack, mancuernas, arbolDiscos, bancoPesas, rack, mancuernas, bancoPesas, arbolDiscos],
        [cinta, bici, cinta, cinta, bici, cinta, bici, cinta],
        [cajones, neumaticos, cuerdas, cajones, neumaticos, cajones, cuerdas, neumaticos],
        [espejo, barraBallet, espejo, espejo, barraBallet, espejo, barraBallet, espejo],
        [gradas, valla, gradas, valla, gradas, valla, gradas, valla],
        [poyete, corcheras, poyete, corcheras, poyete, corcheras, poyete, corcheras],
        [canasta, gradas, canasta, gradas, canasta, gradas, canasta, gradas],
        [esquinaRing, esquinaRing, esquinaRing, esquinaRing, esquinaRing, esquinaRing, esquinaRing, esquinaRing]
    ];
    const piezas = REPERTORIO[zi] || REPERTORIO[0];
    piezas.forEach((fn, i) => fn((i + 0.5) * (bw / piezas.length), 0.85 + ((i * 37) % 5) * 0.06));

    // Rodapié
    g.fillStyle = 'rgba(0,0,0,0.7)';
    g.fillRect(0, suelo - 3, bw, 3);

    return c;
}

/**
 * Textura del suelo de caucho: motas, vetas y algún desconchón. La densidad
 * crece hacia abajo porque ahí el suelo está más cerca y se ve más detalle,
 * que es justo lo que hace que parezca material y no un degradado.
 */
function buildCaucho() {
    const h = Math.round(H * (1 - HORIZON));
    const c = offscreen(W, h);
    const g = c.getContext('2d');

    for (let i = 0; i < 2600; i++) {
        // Sesgo hacia abajo: cerca se ve el grano, lejos se pierde
        const f = Math.pow(Math.random(), 0.45);
        const y = f * h;
        const x = Math.random() * W;
        const t = 0.35 + f * 1.5;
        g.fillStyle = Math.random() < 0.55
            ? `rgba(255,255,255,${0.014 + f * 0.03})`
            : `rgba(0,0,0,${0.05 + f * 0.10})`;
        g.fillRect(x, y, t, t);
    }

    // Desconchones y manchas de uso
    for (let i = 0; i < 26; i++) {
        const f = Math.pow(Math.random(), 0.4);
        const y = f * h;
        const x = Math.random() * W;
        const r = (3 + Math.random() * 16) * (0.3 + f);
        g.fillStyle = `rgba(0,0,0,${0.05 + Math.random() * 0.07})`;
        g.beginPath();
        g.ellipse(x, y, r, r * 0.32, Math.random(), 0, Math.PI * 2);
        g.fill();
    }

    // Juntas del pavimento: losetas de caucho, más juntas al fondo
    g.strokeStyle = 'rgba(0,0,0,0.22)';
    for (let i = 0; i < 9; i++) {
        const y = Math.pow(i / 9, 2.1) * h;
        g.lineWidth = 0.6 + (y / h) * 1.6;
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(W, y);
        g.stroke();
    }

    return c;
}

function buildVignette() {
    const c = offscreen(W, H);
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(W / 2, H * 0.55, H * 0.30, W / 2, H * 0.55, H * 0.98);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    // El grano va horneado aquí dentro: mata el bandeado sin costar un
    // relleno a pantalla completa en cada fotograma
    g.globalAlpha = 0.05;
    for (let i = 0; i < 9000; i++) {
        g.fillStyle = Math.random() < 0.5 ? '#fff' : '#000';
        g.fillRect(Math.random() * W, Math.random() * H, 1, 1);
    }
    g.globalAlpha = 1;
    return c;
}

export function setSize(w, h) {
    if (Math.abs(w - W) < 1 && Math.abs(h - H) < 1 && layers.backdrop) return;
    W = w;
    H = h;

    // En vertical la escena no se puede componer igual que en apaisado: con la
    // pantalla alta y estrecha hay que subir el horizonte y bajar al corredor,
    // o la pista se queda en una franja en medio con hueco muerto arriba.
    const vertical = h / w > 1.15;
    HORIZON = vertical ? 0.34 : 0.30;
    GROUND = vertical ? 0.90 : 0.86;

    layers.backdrop = buildBackdrop(zonaActual);
    layers.backdropPrev = null;
    layers.vignette = buildVignette();
    layers.caucho = buildCaucho();
    if (!glows.verde) for (const [k, v] of Object.entries(COL)) glows[k] = buildGlow(v);
}

export function initRender(canvas) {
    ctx = canvas.getContext('2d');
}

function glow(name, x, y, size, alpha = 1) {
    const sprite = glows[name];
    if (!sprite) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size);
    ctx.restore();
}

/** Polígono sólido a partir de pares x,y. */
function quad(pts, fill) {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
}

function neonLine(x1, y1, x2, y2, color, width, alpha = 1) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = rgba(color, 0.16 * alpha);
    ctx.lineWidth = width * 4;
    ctx.stroke();
    ctx.strokeStyle = rgba(color, 0.95 * alpha);
    ctx.lineWidth = width;
    ctx.stroke();
}

// ================= Partículas =================
const particles = [];
const MAX_PARTICLES = 150;

function addParticle(p) {
    if (particles.length >= MAX_PARTICLES) particles.shift();
    particles.push(p);
}

function burst(x, y, color, n, power) {
    for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = power * (0.35 + Math.random() * 0.9);
        addParticle({
            x, y,
            vx: Math.cos(a) * v,
            vy: Math.sin(a) * v - power * 0.35,
            life: 0.45 + Math.random() * 0.5,
            age: 0,
            size: 2 + Math.random() * 3.5,
            color,
            grav: 900
        });
    }
}

function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.age += dt;
        if (p.age >= p.life) { particles.splice(i, 1); continue; }
        p.vy += p.grav * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
    }
}

function drawParticles() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of particles) {
        const t = 1 - p.age / p.life;
        ctx.globalAlpha = t;
        ctx.fillStyle = rgba(COL[p.color], 0.95);
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size * t);
    }
    ctx.restore();
}

// ================= Efectos =================
let shake = 0;
let hitFlash = 0;
let punch = 0;          // golpe de cámara: un tirón de zoom que se relaja
let flashPerfecto = 0;  // destello blanco del esquive al límite
let marcaPendiente = null;
let barrido = 0;        // barrido de luz al cambiar de sala
let popups = [];

export const fx = {
    hit(lane) {
        shake = 30;
        hitFlash = 1;
        punch = 1;
        burst(xAt(laneU(lane), 0), yAt(0) - unitAt(0) * 0.5, 'rojo', 28, 430);
    },
    dodge(lane) {
        burst(xAt(laneU(lane), 0), yAt(0) - unitAt(0) * 0.3, 'cian', 8, 240);
    },
    /** La barra de la máquina llega a su sitio: se nota en la pantalla. */
    maquina(lane, tipo) {
        const x = xAt(laneU(lane), 0);
        const u = unitAt(0);
        if (tipo === 'prensa') {
            shake = Math.max(shake, 14);           // se estampa contra el suelo
            burst(x, yAt(0), 'ambar', 16, 340);
        } else {
            shake = Math.max(shake, 7);
            burst(x, yAt(0) - u * 0.78, 'cian', 12, 260);
        }
    },
    /**
     * Peldaño pisado. Los carteles se van apilando hacia arriba según encadenas,
    /** Barrido de luz al entrar en una sala nueva. */
    cambioZona() {
        barrido = 1;
        portalZona();   // el pórtico que cruzas al entrar
    },
    /**
     * Esquive al límite. Destello, tirón de zoom y el contador de encadenados.
     * Es el único momento en que el juego te dice que eso ha estado muy bien,
     * y no se puede farmear: hay que apurar de verdad.
     */
    perfecto(lane, seguidos) {
        const x = xAt(laneU(lane), 0);
        const y = yAt(0) - unitAt(0) * 0.7;
        // Discreto a propósito: unas chispas y ya. Sin cartel ni zoom.
        burst(x, y, 'blanco', 9, 240);
        if (seguidos > 1) {
            popups.push({ x, y: y - unitAt(0) * 0.35, text: 'x' + seguidos, age: 0, life: 0.8 });
        }
    },
    /** Planta una marca de tiempo a cada lado, como los carteles de una carrera. */
    marcaTiempo(texto) {
        marcaPendiente = texto;
    },
    jump(lane) {
        const x = xAt(laneU(lane), 0);
        for (let i = 0; i < 10; i++) {
            addParticle({
                x: x + (Math.random() - 0.5) * unitAt(0) * 0.5,
                y: yAt(0),
                vx: (Math.random() - 0.5) * 120,
                vy: -Math.random() * 60,
                life: 0.35 + Math.random() * 0.3,
                age: 0, size: 2 + Math.random() * 2,
                color: 'blanco', grav: 260
            });
        }
    },
    land(lane) {
        shake = Math.max(shake, 8);
        const x = xAt(laneU(lane), 0);
        for (let i = 0; i < 14; i++) {
            addParticle({
                x, y: yAt(0),
                vx: (Math.random() - 0.5) * 420,
                vy: -Math.random() * 120,
                life: 0.3 + Math.random() * 0.35,
                age: 0, size: 2 + Math.random() * 3,
                color: 'blanco', grav: 900
            });
        }
    },
    /** Caída final: el muñeco rueda por la cinta. */
    death(lane) {
        shake = 34;
        punch = 1.4;
        const x = xAt(laneU(lane), 0);
        burst(x, yAt(0) - unitAt(0) * 0.4, 'rojo', 22, 380);
        for (let i = 0; i < 18; i++) {
            addParticle({
                x, y: yAt(0),
                vx: (Math.random() - 0.5) * 300,
                vy: -Math.random() * 200,
                life: 0.5 + Math.random() * 0.5,
                age: 0, size: 2 + Math.random() * 3,
                color: 'acero', grav: 700
            });
        }
    },
    reset() {
        particles.length = 0;
        popups = [];
        trail.length = 0;
        resetProps();
        marcaPendiente = null;
        shake = 0;
        hitFlash = 0;
        punch = 0;
    }
};

// ================= Las dos cintas =================
const BELT = 0.94;   // media anchura de una cinta, en unidades de carril
const RAIL = [-1.06, 1.06];   // solo las barandillas de fuera

/** Franja recta que va del fondo al jugador: sirve para cintas y barandillas. */
function strip(u0, u1, alturaUnits, fill) {
    const y0f = yAt(1) - alturaUnits * unitAt(1);
    const y1f = yAt(0) - alturaUnits * unitAt(0);
    quad([
        xAt(u0, 1), y0f,
        xAt(u1, 1), y0f,
        xAt(u1, 0), y1f,
        xAt(u0, 0), y1f
    ], fill);
}

/**
 * El suelo de cada sitio.
 *
 * Es el elemento que más rato tienes delante durante una partida, y hasta ahora
 * era el mismo caucho de gimnasio en las ocho salas — también en la piscina y
 * en la pista de atletismo. Cada bioma pinta lo suyo A LOS LADOS de las cintas;
 * las cintas se quedan como están, porque sigues corriendo sobre ellas.
 *
 * Todo se dibuja con franjas rectas del fondo al jugador: en esta proyección
 * una línea de u constante sale recta en pantalla, así que las calles de la
 * pista o las líneas de la cancha salen gratis.
 */

/** Franja larga a lo largo de la pista, del horizonte a tus pies. */
function raya(u, ancho, fill) {
    strip(u - ancho / 2, u + ancho / 2, 0, fill);
}

/** Marcas que corren HACIA el jugador, como los listones de la cinta. */
function travesanos(roadPhase, u0, u1, n, color, grosor) {
    for (let i = 0; i < n; i++) {
        let z = ((i / n) - roadPhase % 1 + 1) % 1;
        z = z * z;
        const s = scaleAt(z);
        const y = yAt(z);
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(0.6, grosor * s);
        ctx.beginPath();
        ctx.moveTo(xAt(u0, z), y);
        ctx.lineTo(xAt(u1, z), y);
        ctx.stroke();
    }
}

const FUERA_IZQ = [-4.2, -1.06];
const FUERA_DER = [1.06, 4.2];

function sueloZona(roadPhase, now) {
    const lados = [FUERA_IZQ, FUERA_DER];

    switch (zonaActual) {
        case 0:   // Sala de pesas: losetas de caucho con sus juntas
        case 2: { // Box de crossfit: igual pero más gastado
            for (const [a, b] of lados) strip(a, b, 0, zonaActual === 2 ? '#1d1b17' : '#191c23');
            for (const [a, b] of lados) travesanos(roadPhase, a, b, 10, 'rgba(0,0,0,0.35)', 2);
            break;
        }
        case 1: { // Cardio: suelo oscuro y la huella de las máquinas
            for (const [a, b] of lados) strip(a, b, 0, '#161b22');
            for (const u of [-2.6, -1.7, 1.7, 2.6]) raya(u, 0.5, 'rgba(255,255,255,0.03)');
            break;
        }
        case 3: { // Posing: suelo pulido, con brillo largo
            for (const [a, b] of lados) strip(a, b, 0, '#14161c');
            for (const u of [-2.2, -1.4, 1.4, 2.2]) raya(u, 0.20, 'rgba(255,255,255,0.05)');
            break;
        }
        case 4: { // Pista de atletismo: tartán y calles blancas
            for (const [a, b] of lados) strip(a, b, 0, '#8a3f26');
            for (const [a, b] of lados) strip(a, b - (b - a) * 0.5, 0, '#7c3822');
            for (const u of [-3.9, -3.2, -2.5, -1.8, -1.12, 1.12, 1.8, 2.5, 3.2, 3.9]) {
                raya(u, 0.055, 'rgba(238,235,228,0.85)');
            }
            break;
        }
        case 5: { // Piscina: agua, corcheras y reflejos que se mueven
            for (const [a, b] of lados) strip(a, b, 0, '#0d3a5c');
            for (const [a, b] of lados) travesanos(roadPhase * 0.6, a, b, 14, 'rgba(150,220,255,0.10)', 3);
            // Corcheras: la línea de boyas que separa las calles
            for (const u of [-3.4, -2.3, -1.2, 1.2, 2.3, 3.4]) {
                raya(u, 0.10, 'rgba(226,238,248,0.55)');
            }
            // Cabrilleo: destellos cortos que se mueven a su aire
            const bri = (Math.sin(now / 700) + 1) / 2;
            for (const [a, b] of lados) {
                travesanos((roadPhase * 0.35 + 0.3) % 1, a, b, 7,
                    `rgba(190,240,255,${0.06 + bri * 0.07})`, 5);
            }
            break;
        }
        case 6: { // Baloncesto: duela de madera y líneas de la cancha
            for (const [a, b] of lados) strip(a, b, 0, '#8a5f30');
            // Las lamas de la duela
            for (const u of [-3.8, -3.3, -2.8, -2.3, -1.8, -1.3, 1.3, 1.8, 2.3, 2.8, 3.3, 3.8]) {
                raya(u, 0.03, 'rgba(60,36,16,0.5)');
            }
            for (const u of [-2.9, 2.9]) raya(u, 0.07, 'rgba(240,236,228,0.8)');
            for (const u of [-1.45, 1.45]) raya(u, 0.055, 'rgba(224,140,60,0.7)');
            break;
        }
        case 7: { // Ring: lona clara con las costuras
            for (const [a, b] of lados) strip(a, b, 0, '#5d4a48');
            for (const [a, b] of lados) travesanos(roadPhase * 0.8, a, b, 8, 'rgba(0,0,0,0.18)', 2);
            for (const u of [-2.0, 2.0]) raya(u, 0.06, 'rgba(210,60,72,0.55)');
            break;
        }
        default: {
            for (const [a, b] of lados) strip(a, b, 0, '#191c23');
        }
    }
}

function drawGround(roadPhase, now) {
    const horizonY = H * HORIZON;

    // Suelo de goma del gimnasio
    const suelo = ctx.createLinearGradient(0, horizonY, 0, H);
    suelo.addColorStop(0, '#232833');
    suelo.addColorStop(1, '#12151c');
    ctx.fillStyle = suelo;
    ctx.fillRect(0, horizonY, W, H - horizonY);

    // Cada sala pinta su suelo a los lados de las cintas
    sueloZona(roadPhase, now);

    // Grano y desconchones por encima, para que el material se note
    if (!layers.caucho) layers.caucho = buildCaucho();
    ctx.globalAlpha = 0.55;
    ctx.drawImage(layers.caucho, 0, horizonY);
    ctx.globalAlpha = 1;

    // Cada carril es una cinta: chasis, banda y listones
    for (const lane of [-1, 1]) {
        const c = laneU(lane);
        // Chasis lateral de la máquina
        strip(c - BELT / 2 - 0.06, c + BELT / 2 + 0.06, 0, '#2c323e');
        // La banda de correr
        strip(c - BELT / 2, c + BELT / 2, 0, '#171b23');
    }

    // Listones de la banda: sólidos, y corren HACIA el jugador.
    // Restar la fase es lo que hace que bajen en pantalla en vez de subir.
    for (let i = 0; i < 20; i++) {
        let z = ((i / 20) - roadPhase % 1 + 1) % 1;
        z = z * z;
        const s = scaleAt(z);
        const y = yAt(z);
        const gris = 0.45 + 0.95 * (1 - z);
        ctx.strokeStyle = `rgb(${(58 * gris) | 0},${(64 * gris) | 0},${(76 * gris) | 0})`;
        ctx.lineWidth = Math.max(1, 3 * s);
        for (const lane of [-1, 1]) {
            const c = laneU(lane);
            ctx.beginPath();
            ctx.moveTo(xAt(c - BELT / 2, z), y);
            ctx.lineTo(xAt(c + BELT / 2, z), y);
            ctx.stroke();
        }
    }

    // Barandillas: cara lateral sólida y filo verde arriba
    for (const u of RAIL) {
        const alto = 0.30;
        strip(u - 0.035, u + 0.035, 0, '#2a3040');            // pie
        strip(u - 0.035, u + 0.035, alto, '#39414f');          // canto superior
        // Cara vertical de la barandilla
        const yTop0 = yAt(1) - alto * unitAt(1);
        const yTop1 = yAt(0) - alto * unitAt(0);
        quad([
            xAt(u + 0.035, 1), yTop0,
            xAt(u + 0.035, 0), yTop1,
            xAt(u + 0.035, 0), yAt(0),
            xAt(u + 0.035, 1), yAt(1)
        ], '#232936');
        // Las barandillas llevan el color de la zona en la que estés
        neonLine(xAt(u, 1), yTop0, xAt(u, 0), yTop1, acento(), 2, 0.85);
    }

    // Separación entre las dos cintas: una raya fina, del mismo gris que los listones
    ctx.strokeStyle = '#3a4048';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(xAt(0, 1), yAt(1));
    ctx.lineTo(xAt(0, 0), yAt(0));
    ctx.stroke();

    // Halo del horizonte, también con el color de la zona
    if (!glows['zona' + zonaActual]) glows['zona' + zonaActual] = buildGlow(ZONAS[zonaActual].acento);
    glow('zona' + zonaActual, W / 2 - camX * W * 0.2, horizonY, H * 0.7, 0.16);
}

// ================= Obstáculos =================
/** Prisma sólido: cara frontal, superior y el lateral que toca ver. */
function prism(u, z, dz, wFrac, yBot, yTop, base) {
    const zb = z + dz;
    const s0 = scaleAt(z);
    const s1 = scaleAt(zb);
    const x0 = xAt(u, z);
    const x1 = xAt(u, zb);
    const hw0 = wFrac * W * s0 / 2;
    const hw1 = wFrac * W * s1 / 2;
    const u0 = unitAt(z);
    const u1 = unitAt(zb);
    const fT = yAt(z) - yTop * u0, fB = yAt(z) - yBot * u0;
    const bT = yAt(zb) - yTop * u1, bB = yAt(zb) - yBot * u1;
    const fL = x0 - hw0, fR = x0 + hw0;
    const bL = x1 - hw1, bR = x1 + hw1;

    quad([bL, bT, bR, bT, bR, bB, bL, bB], tono(base, 0.34));
    quad([fL, fT, fR, fT, bR, bT, bL, bT], tono(base, 1.65));
    if (x0 < W / 2) quad([fR, fT, bR, bT, bR, bB, fR, fB], tono(base, 0.7));
    else quad([fL, fT, bL, bT, bL, bB, fL, fB], tono(base, 0.7));
    quad([fL, fT, fR, fT, fR, fB, fL, fB], tono(base, 1));
    ctx.strokeStyle = tono(base, 1.95);
    ctx.lineWidth = Math.max(1.2, 2.4 * s0);
    ctx.strokeRect(fL, fT, fR - fL, fB - fT);
}

/** Disco de peso: hierro sólido con el aro pintado de verde. */
/**
 * Los obstáculos son objetos de gimnasio, no cajas de colores. Se han quitado
 * los volúmenes verdes/rojos y sus resplandores: la silueta ya dice qué hacer.
 * Una barra tirada en el suelo se salta, una barra alta se pasa por debajo y un
 * banco con su soporte no se pasa de ninguna manera. Todo en acero y goma.
 */
const ACERO = COL.acero;
const GOMA = [30, 34, 42];
/** Pasa una anchura en fracción de pantalla a desplazamiento en unidades de carril. */
const uOff = (frac) => frac / SPREAD;

function drawObstacle(o, now) {
    if (o.z < -0.2) return;
    // El material lo pone la sala: el acero de la piscina es cromo blanco, el
    // del ring es negro mate, el del box es acero crudo. Mismo objeto, mismo
    // gesto, distinto deporte.
    const M = matZona();
    const ACERO = M.estructura;
    const GOMA = M.detalle;
    const u = laneU(o.lane);
    const dz = 0.13;
    const s = scaleAt(o.z);
    const x = xAt(u, o.z);
    const gy = yAt(o.z);
    const uu = unitAt(o.z);
    const hw = 0.30 * W * s / 2;

    // Anclar el obstáculo al suelo: sin sombra de contacto parece pegado sobre
    // el fondo por bien dibujado que esté
    if (o.type !== 'saco' && o.type !== 'cuerda') sombraContacto(x, gy, hw * 1.6, 0.95);

    if (o.type === 'dominadas') {
        // Pórtico de dominadas: dos postes y la barra arriba
        const poste = uOff(0.15);
        prism(u - poste, o.z, dz, 0.045, 0, 0.98, ACERO);
        prism(u + poste, o.z, dz, 0.045, 0, 0.98, ACERO);
        prism(u, o.z, dz * 0.5, 0.34, 0.86, 0.98, ACERO);
        // Agarres de goma, que es por donde se cogería de verdad
        const agarre = uOff(0.07);
        prism(u - agarre, o.z, dz * 0.5, 0.07, 0.87, 0.97, GOMA);
        prism(u + agarre, o.z, dz * 0.5, 0.07, 0.87, 0.97, GOMA);
    } else if (o.type === 'barra') {
        // Barra olímpica en el suelo con un disco a cada lado
        prism(u, o.z, dz * 0.35, 0.34, 0.13, 0.18, ACERO);
        const r = uu * 0.21;
        for (const lado of [-1, 1]) {
            const cx = x + lado * hw;
            const cy = gy - r * 0.82;
            ctx.beginPath();
            ctx.ellipse(cx, cy, r * 0.34, r, 0, 0, Math.PI * 2);
            ctx.fillStyle = tono(GOMA, 1);
            ctx.fill();
            ctx.strokeStyle = tono(ACERO, 1.25);
            ctx.lineWidth = Math.max(1.4, 2.6 * s);
            ctx.stroke();
            // Buje interior, para que se lea como disco y no como bola
            ctx.beginPath();
            ctx.ellipse(cx, cy, r * 0.12, r * 0.34, 0, 0, Math.PI * 2);
            ctx.strokeStyle = tono(ACERO, 0.85);
            ctx.lineWidth = Math.max(1, 1.6 * s);
            ctx.stroke();
        }
    } else if (o.type === 'saco') {
        // Saco de boxeo colgado: oscila entre los dos carriles
        const su = sacoU(o, now);
        const sx = xAt(su, o.z);
        ctx.strokeStyle = tono(ACERO, 0.9);
        ctx.lineWidth = Math.max(1, 2.4 * s);
        ctx.beginPath();
        ctx.moveTo(xAt(su * 0.35, o.z), gy - 2.0 * uu);
        ctx.lineTo(sx, gy - 1.10 * uu);
        ctx.stroke();
        const sw = 0.17 * W * s;
        prism(su, o.z, dz, 0.17, 0.34, 1.10, GOMA);
        ctx.strokeStyle = tono(ACERO, 1.1);
        ctx.lineWidth = Math.max(1, 2 * s);
        for (const h of [0.45, 0.72, 0.99]) {
            ctx.beginPath();
            ctx.moveTo(sx - sw / 2, gy - h * uu);
            ctx.lineTo(sx + sw / 2, gy - h * uu);
            ctx.stroke();
        }
    } else if (o.type === 'prensa' || o.type === 'polea') {
        // Un solo movimiento y bien largo: la prensa se desploma desde el techo
        // hasta el suelo, la polea se levanta del suelo hasta el pecho. Lo que
        // te dice qué hacer es hacia DÓNDE VA, no dónde acaba.
        const altura = barraMovilAltura(o.type, o.z);
        const guia = uOff(0.17);
        const tope = BARRA_ALTURA_MAX;
        prism(u - guia, o.z, dz * 0.5, 0.045, 0, tope, ACERO);
        prism(u + guia, o.z, dz * 0.5, 0.045, 0, tope, ACERO);
        prism(u, o.z, dz * 0.4, 0.38, tope - 0.09, tope, ACERO);

        // Estela: la barra en los sitios por los que acaba de pasar. Es lo que
        // hace que el movimiento cante aunque la mires de reojo.
        for (let k = 1; k <= 5; k++) {
            const previa = barraMovilAltura(o.type, Math.min(1.25, o.z + k * 0.045));
            if (Math.abs(previa - altura) < 0.02) break;
            ctx.globalAlpha = 0.30 - k * 0.05;
            prism(u, o.z, dz * 0.4, 0.32, previa - 0.08, previa, ACERO);
            ctx.globalAlpha = 1;
        }
        // Mientras se mueve, la barra se enciende: es imposible no verla
        if (barraEnMovimiento(o.z)) {
            glow(o.type === 'prensa' ? 'ambar' : 'cian', x, gy - altura * uu, hw * 5, 0.55);
        }

        // La barra, más gorda que antes, con sus discos
        prism(u, o.z, dz * 0.55, 0.36, altura - 0.11, altura, ACERO);
        const r = uu * 0.19;
        for (const lado of [-1, 1]) {
            ctx.beginPath();
            ctx.ellipse(x + lado * hw, gy - (altura - 0.055) * uu, r * 0.36, r, 0, 0, Math.PI * 2);
            ctx.fillStyle = tono(GOMA, 1);
            ctx.fill();
            ctx.strokeStyle = tono(ACERO, 1.3);
            ctx.lineWidth = Math.max(1.4, 2.6 * s);
            ctx.stroke();
        }
    } else if (o.type === 'cuerda') {
        // Comba que barre los dos carriles: baja según se acerca y acaba en el suelo
        const alto = cuerdaAltura(o, o.z);
        const abajo = cuerdaAbajo(o.z);
        const combaY = gy - alto * uu;
        const izq = xAt(-1.02, o.z), der = xAt(1.02, o.z);
        const postesY = gy - 1.62 * uu;

        // Los dos que dan a la comba, uno a cada lado
        ctx.strokeStyle = tono(ACERO, 0.8);
        ctx.lineWidth = Math.max(1, 2.6 * s);
        ctx.beginPath();
        ctx.moveTo(izq, gy); ctx.lineTo(izq, postesY);
        ctx.moveTo(der, gy); ctx.lineTo(der, postesY);
        ctx.stroke();

        // La cuerda. El punto de control de una curva cuadrática NO está sobre
        // la curva: la panza llega solo a la mitad. Hay que compensarlo o la
        // comba se queda flotando a media altura y no hay quien la entienda.
        const control = 2 * combaY - postesY;
        ctx.strokeStyle = abajo ? tono(COL.ambar, 1) : tono(ACERO, 1.2);
        ctx.lineWidth = Math.max(2.5, (abajo ? 6 : 4.5) * s);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(izq, postesY);
        ctx.quadraticCurveTo((izq + der) / 2, control, der, postesY);
        ctx.stroke();
        if (abajo) glow('ambar', (izq + der) / 2, gy - 0.05 * uu, uu * 3, 0.45);
    } else if (o.type === 'balon') {
        // Balón medicinal rodando: cambia de carril por el camino
        const bu = balonU(o, o.z);
        const bx = xAt(bu, o.z);
        const r = uu * 0.26;
        const giro = -o.z * 9;
        ctx.save();
        ctx.translate(bx, gy - r);
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fillStyle = tono(GOMA, 1.35);
        ctx.fill();
        ctx.strokeStyle = tono(ACERO, 1.1);
        ctx.lineWidth = Math.max(1, 2 * s);
        ctx.stroke();
        // Costuras que giran: sin esto no se ve que rueda
        ctx.rotate(giro);
        ctx.strokeStyle = tono(ACERO, 0.9);
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 0.42, r, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-r, 0); ctx.lineTo(r, 0);
        ctx.stroke();
        ctx.restore();
    } else if (o.type === 'escalon') {
        // Escalera de agilidad pintada en el suelo. Con los largueros a los
        // lados se entiende que es una escalera para pisar y no una raya suelta.
        const largo = 0.30 * W * s / 2;
        const paso = 0.09 * uu;
        ctx.strokeStyle = tono(COL.verde, 0.55);
        ctx.lineWidth = Math.max(1, 2.4 * s);
        ctx.beginPath();
        ctx.moveTo(x - largo, gy - paso); ctx.lineTo(x - largo, gy + paso);
        ctx.moveTo(x + largo, gy - paso); ctx.lineTo(x + largo, gy + paso);
        ctx.stroke();
        // El travesaño
        neonLine(x - largo, gy, x + largo, gy, COL.verde, Math.max(2, 4 * s), 0.9);
    } else if (o.type === 'banco') {
        // Banco de press con su soporte: ocupa el carril de lado a lado
        const pata = uOff(0.10);
        prism(u - pata, o.z, dz, 0.05, 0, 0.32, ACERO);
        prism(u + pata, o.z, dz, 0.05, 0, 0.32, ACERO);
        // Acolchado
        prism(u, o.z, dz, 0.30, 0.32, 0.46, GOMA);
        // Soporte de la barra y la barra encima
        const soporte = uOff(0.15);
        prism(u - soporte, o.z, dz * 0.6, 0.045, 0.46, 1.00, ACERO);
        prism(u + soporte, o.z, dz * 0.6, 0.045, 0.46, 1.00, ACERO);
        prism(u, o.z, dz * 0.45, 0.36, 0.96, 1.04, ACERO);
    }
}

// ================= El corredor =================
const trail = [];

/**
 * La cámara va DETRÁS del corredor, así que un ciclo de carrera de perfil se ve
 * como si corriera de lado. Aquí el esqueleto se monta en 3D sencillo y se
 * proyecta: lo que se aleja de la cámara sube en pantalla y se estrecha, lo que
 * viene hacia ella baja y se ensancha. Eso es lo que hace que se lea "hacia
 * adelante": la pierna que va al frente se esconde y sube, la que empuja atrás
 * baja hacia ti.
 */
function drawRunner(game, now) {
    const u = unitAt(0);
    const baseX = xAt(laneU(game.laneVisual), 0);
    const groundY = yAt(0);

    const jumping = now < game.jumpUntil;
    const ducking = now < game.duckUntil;
    const muriendo = game.dying > 0;
    const tMuerte = muriendo ? Math.min(1, (now - game.dying) / game.deathMs) : 0;
    const tGolpe = Math.min(1, (now - game.lastHit) / 420);
    const golpeado = tGolpe < 1 && !muriendo;

    let lift = 0;
    let stretch = 1;
    let saltoP = 0;
    if (jumping) {
        saltoP = 1 - (game.jumpUntil - now) / game.jumpMs;
        lift = Math.sin(saltoP * Math.PI) * u * 0.60;
        stretch = 1 + Math.cos(saltoP * Math.PI) * 0.14;

        // ANTICIPACIÓN: el primer 14% del salto se hunde y se comprime antes de
        // despegar. No retrasa nada de la física — el salto ya está en marcha —
        // pero sin esto el muñeco sale disparado como si tirasen de él.
        if (saltoP < 0.14) {
            const k = 1 - saltoP / 0.14;
            const carga = Math.sin(k * Math.PI);
            stretch -= carga * 0.22;
            lift -= carga * u * 0.07;
        }
    }

    // ATERRIZAJE: aplastado que se recupera, los 180 ms de después de tocar
    const desdeAterrizar = now - (game.jumpUntil || 0);
    if (!jumping && desdeAterrizar >= 0 && desdeAterrizar < 180 && !muriendo) {
        const k = 1 - desdeAterrizar / 180;
        stretch -= Math.sin(k * Math.PI * 0.9) * 0.20;
    }

    // Proporciones
    const alto = (ducking && !muriendo ? u * 0.52 : u * 0.86) * stretch;
    const muslo = alto * 0.235, tibia = alto * 0.225;
    const pierna = muslo + tibia;
    const torso = alto * 0.40;
    const headR = alto * 0.115;
    const caderaW = alto * 0.095, hombroW = alto * 0.15;
    const brazo = alto * 0.19, ante = alto * 0.175;
    const grosor = Math.max(2.5, alto * 0.078);

    const fase = game.runPhase;
    const corriendo = !jumping && !ducking && !golpeado && !muriendo;

    // Sube en el impulso, baja al apoyar, y la cadera se desplaza al lado que carga
    const bob = corriendo ? Math.abs(Math.cos(fase)) * alto * 0.04 : 0;
    const sway = corriendo ? Math.sin(fase) * alto * 0.035 : 0;

    let caida = 0, tilt = 0;
    if (muriendo) {
        const e = 1 - Math.pow(1 - tMuerte, 3);
        tilt = e * 1.45;
        caida = e * pierna * 0.8;
    } else if (golpeado) {
        tilt = Math.sin(tGolpe * Math.PI) * -0.40;
    }

    // Al caer en cuclillas la cadera rebota un poco y se asienta
    const desdeAgacharse = now - (game.duckStarted || 0);
    const rebote = ducking && !muriendo
        ? Math.exp(-desdeAgacharse / 130) * Math.sin(desdeAgacharse / 42) * alto * 0.07
        : 0;
    const hipY = groundY - lift - pierna + bob - caida + rebote;
    const color = golpeado || muriendo ? tono(COL.rojo, 1) : tono(COL.blanco, 1);

    // Estela corta
    trail.push({ x: baseX, y: hipY - torso, h: pierna + torso });
    while (trail.length > 7) trail.shift();
    if (corriendo) {
        for (let i = 0; i < trail.length - 1; i++) {
            const g = trail[i];
            ctx.globalAlpha = (i / trail.length) * 0.16;
            ctx.fillStyle = tono(COL.cian, 1);
            ctx.fillRect(g.x - u * 0.09, g.y, u * 0.18, g.h);
        }
        ctx.globalAlpha = 1;
    }

    // Reflejo en el caucho: el mismo cuerpo volteado, aplastado y casi
    // transparente. Es lo que hace que el suelo parezca material y no un color.
    if (!muriendo) {
        ctx.save();
        ctx.globalAlpha = 0.13;
        ctx.translate(baseX, groundY);
        ctx.scale(1, -0.45);
        ctx.translate(-baseX, -groundY);
        ctx.fillStyle = tono(COL.cian, 1);
        ctx.fillRect(baseX - u * 0.13, hipY - torso - headR * 2, u * 0.26, torso + pierna + headR * 2);
        ctx.restore();
    }

    // Sombra
    const shrink = Math.max(0.25, 1 - lift / (u * 1.6));
    ctx.beginPath();
    ctx.ellipse(baseX, groundY, u * 0.26 * shrink, u * 0.07 * shrink, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0,0,0,${0.55 * shrink})`;
    ctx.fill();

    glow(golpeado || muriendo ? 'rojo' : 'cian', baseX, hipY - torso * 0.4, u * 1.9, 0.40);

    ctx.save();
    ctx.translate(baseX, hipY);
    ctx.rotate(tilt);

    // Proyección local: lz positivo = se aleja de la cámara
    const RISE = 0.45;
    const NARROW = 0.20;
    const px = (lx, lz) => lx * (1 - NARROW * lz / pierna);
    const py = (ly, lz) => ly - RISE * lz;

    // ---- Postura de cada pierna según el estado ----
    const posturaPierna = (lado, p) => {
        if (muriendo) return { th: lado > 0 ? 1.5 : 1.1, flex: 0.35 };
        if (golpeado) {
            const k = Math.sin(tGolpe * Math.PI);
            return { th: lado > 0 ? 0.6 + k * 0.5 : -0.35 - k * 0.4, flex: 0.55 + k * 0.4 };
        }
        // Cuclillas: rodilla muy flexionada y los muslos abiertos hacia fuera,
        // que es lo que se ve de una sentadilla mirándola por detrás
        if (ducking) return { th: 0.62 + lado * 0.08, flex: 2.25 };
        if (jumping) {
            const tuck = Math.sin(saltoP * Math.PI);
            return { th: (lado > 0 ? 0.55 : 0.25) * tuck + 0.08, flex: 1.6 * tuck + 0.2 };
        }
        // Carrera: el muslo va y viene, la rodilla se recoge justo tras el impulso
        return { th: 0.82 * Math.sin(p), flex: Math.max(0, Math.sin(p + 1.15)) * 1.5 };
    };

    const posturaBrazo = (lado, p) => {
        if (muriendo) return { th: lado > 0 ? -2.4 : -1.9, flex: 0.4 };
        if (golpeado) {
            const k = Math.sin(tGolpe * Math.PI);
            return { th: -2.3 - k * 0.5, flex: 0.5 };
        }
        // Brazos al frente para equilibrar, como en una sentadilla de verdad
        if (ducking) return { th: 1.35, flex: 1.15 };
        if (jumping) {
            const tuck = Math.sin(saltoP * Math.PI);
            return { th: -0.4 - 1.7 * tuck, flex: 0.9 - 0.4 * tuck };
        }
        // Los brazos van en contrafase con las piernas
        return { th: -0.68 * Math.sin(p), flex: 1.30 + 0.42 * Math.max(0, Math.sin(p)) };
    };

    /** Devuelve los tres puntos ya proyectados y la profundidad del extremo. */
    const cadena = (ox, oy, l1, l2, th, flex, fuera, oz = 0) => {
        const kx = ox + fuera;
        const ky = oy + l1 * Math.cos(th);
        const kz = oz + l1 * Math.sin(th);
        const a2 = th + flex * (l2 === ante ? 1 : -1);   // el codo dobla al frente, la rodilla atrás
        const ex = kx + fuera * 0.4;
        const ey = ky + l2 * Math.cos(a2);
        const ez = kz + l2 * Math.sin(a2);
        return {
            pts: [
                px(ox, oz), py(oy, oz),
                px(kx, kz), py(ky, kz),
                px(ex, ez), py(ey, ez)
            ],
            z: ez
        };
    };

    const trazo = (c, ancho, alpha) => {
        ctx.globalAlpha = alpha;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = color;
        ctx.lineWidth = ancho;
        ctx.beginPath();
        ctx.moveTo(c.pts[0], c.pts[1]);
        ctx.lineTo(c.pts[2], c.pts[3]);
        ctx.lineTo(c.pts[4], c.pts[5]);
        ctx.stroke();
        ctx.globalAlpha = 1;
    };

    const hombroY = -torso;
    // Agachado el tronco se echa hacia delante: los hombros se van en
    // profundidad, y al proyectarlos suben y encogen. Eso es lo que da la
    // sensación de estar recogido en vez de simplemente más bajo.
    const hombroZ = ducking && !muriendo ? torso * 0.62 : 0;
    // Y las rodillas se abren hacia fuera
    const rodillaFuera = ducking && !muriendo ? alto * 0.11 : 0;

    const piernas = [1, -1].map((lado) => {
        const { th, flex } = posturaPierna(lado, fase + (lado > 0 ? 0 : Math.PI));
        return { lado, ...cadena(lado * caderaW + sway, 0, muslo, tibia, th, flex, lado * rodillaFuera) };
    });
    const brazos = [1, -1].map((lado) => {
        const { th, flex } = posturaBrazo(lado, fase + (lado > 0 ? Math.PI : 0));
        return { lado, ...cadena(lado * hombroW - sway * 0.6, hombroY, brazo, ante, th, flex, lado * alto * 0.03, hombroZ) };
    });

    // Lo que está más lejos se pinta primero y más apagado
    piernas.sort((a, b) => b.z - a.z);
    brazos.sort((a, b) => b.z - a.z);

    trazo(piernas[0], grosor, 0.72);
    trazo(brazos[0], grosor * 0.85, 0.72);

    // Tronco: cadera y hombros como barras cortas, que es lo que delata que se
    // le está viendo por la espalda
    ctx.strokeStyle = color;
    ctx.lineWidth = grosor * 0.8;
    ctx.beginPath();
    ctx.moveTo(px(-caderaW + sway, 0), py(0, 0));
    ctx.lineTo(px(caderaW + sway, 0), py(0, 0));
    ctx.moveTo(px(-hombroW - sway * 0.6, hombroZ), py(hombroY, hombroZ));
    ctx.lineTo(px(hombroW - sway * 0.6, hombroZ), py(hombroY, hombroZ));
    ctx.stroke();

    ctx.lineWidth = grosor * 1.25;
    ctx.beginPath();
    ctx.moveTo(px(sway, 0), py(0, 0));
    ctx.lineTo(px(-sway * 0.6, hombroZ), py(hombroY, hombroZ));
    ctx.stroke();

    trazo(piernas[1], grosor, 1);
    trazo(brazos[1], grosor * 0.85, 1);

    // Cabeza
    ctx.beginPath();
    ctx.arc(px(-sway * 0.6, hombroZ), py(hombroY - headR * 0.95, hombroZ), headR, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.restore();
}

// ================= Post-proceso =================
function drawSpeedLines(speed) {
    const intensity = Math.max(0, (speed - 0.62) / 0.5);
    if (intensity <= 0) return;
    const cx = W / 2 - camX * W * 0.2;
    const cy = H * HORIZON;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2 + (i % 3);
        const r0 = H * 0.35;
        const r1 = r0 + H * (0.25 + (i % 4) * 0.12);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0 * 0.6);
        ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1 * 0.6);
        ctx.strokeStyle = rgba(COL.blanco, 0.09 * intensity);
        ctx.lineWidth = 2;
        ctx.stroke();
    }
    ctx.restore();
}

function drawPopups(dt) {
    ctx.save();
    ctx.textAlign = 'center';
    for (let i = popups.length - 1; i >= 0; i--) {
        const p = popups[i];
        p.age += dt;
        if (p.age >= p.life) { popups.splice(i, 1); continue; }
        const t = p.age / p.life;
        ctx.globalAlpha = 1 - t;
        ctx.font = `800 ${Math.round(W * 0.028)}px Outfit, sans-serif`;
        ctx.fillStyle = tono(COL.verde, 1);
        ctx.fillText(p.text, p.x, p.y - t * H * 0.09);
    }
    ctx.restore();
}

// ================= Decorado que te adelanta =================
/**
 * Reglas del decorado:
 *
 * 1. SIMETRÍA. Todo sale por parejas, lo mismo a la izquierda que a la derecha
 *    y a la misma distancia. Un gimnasio está montado a plomo, no a voleo.
 * 2. CARRILES FIJOS. Además de los dos carriles de la pista hay dos carriles
 *    invisibles, uno por lado, donde se planta el decorado cercano; y otros dos
 *    más afuera para el fondo. Nada aparece a una distancia inventada.
 * 3. CONTENIDO PROPIO. Cada sala tiene su material y su gente haciendo lo que
 *    se hace ahí: press de banca en pesas, bicis en cardio, alguien posando en
 *    la zona de fotos, corredores en la pista.
 */
const props = [];
const MAX_PROPS = 90;

/**
 * Los carriles del decorado. Tres por lado, seis en total, además de los dos
 * de la pista. Cuanto más afuera: más pequeño, más lavado por la niebla y más
 * rato en pantalla antes de salirse por el lado, que es exactamente lo que
 * hace que el gimnasio parezca grande en vez de un pasillo.
 */
const CARRILES = [
    { u: 1.45, esc: 1.00, bruma: 1.00, peso: 0.40 },
    { u: 2.40, esc: 0.74, bruma: 1.30, peso: 0.34 },
    { u: 3.70, esc: 0.52, bruma: 1.55, peso: 0.26 }
];
const CARRIL_CERCA = CARRILES[0].u;   // lo usan las marcas de tiempo

/**
 * DOS generadores en paralelo, no uno. Uno se ocupa del carril de al lado de la
 * pista y el otro de los dos de fuera, así que siempre hay capa cercana Y capa
 * de fondo a la vez. Con un solo generador el gimnasio salía a rachas: un rato
 * cosas cerca, un rato cosas lejos, y nunca las dos.
 */
const capas = [
    { carriles: [0], dist: 0, grupo: null, espera: 0.25 },
    { carriles: [1, 2], dist: 0, grupo: null, espera: 0.18 }
];

/**
 * Qué hay en cada sala. Cada entrada es [forma, cuántas seguidas, cada cuánto].
 * La primera de la lista sale el doble que las demás.
 */
const SALAS = [
    // 0 Sala de pesas
    [['press', 2, 0.46], ['sentadilla', 2, 0.46], ['militar', 2, 0.44],
     ['curl', 3, 0.34], ['rack', 3, 0.36], ['taquillas', 3, 0.28]],
    // 1 Zona de cardio
    [['bici', 4, 0.30], ['cinta', 4, 0.34], ['escaleraMec', 2, 0.50], ['bici', 5, 0.28]],
    // 2 Box de crossfit
    [['cajon', 3, 0.30], ['neumatico', 3, 0.28], ['kettlebell', 4, 0.24],
     ['anillas', 2, 0.46], ['cuerdaBatalla', 2, 0.44]],
    // 3 Zona de posing
    [['posando', 2, 0.48], ['foto', 3, 0.36], ['podio', 1, 0.9], ['posando', 2, 0.44]],
    // 4 Pista de atletismo
    [['corredor', 4, 0.32], ['valla', 4, 0.30], ['foso', 1, 1.0], ['grada', 5, 0.26]],
    // 5 Piscina
    [['nadador', 3, 0.34], ['poyete', 4, 0.30], ['socorrista', 1, 0.9], ['grada', 4, 0.28]],
    // 6 Cancha de baloncesto
    [['jugador', 3, 0.34], ['canasta', 1, 0.9], ['grada', 5, 0.26], ['jugador', 2, 0.40]],
    // 7 Ring de boxeo
    [['boxeador', 2, 0.44], ['saco', 3, 0.34], ['esquina', 2, 0.60], ['publico', 5, 0.26]]
];

export function resetProps() {
    props.length = 0;
    for (const c of capas) { c.dist = 0; c.grupo = null; c.espera = 0.25; }
}

/** Abre la sala nueva con un pórtico que te pasa por encima. */
export function portalZona() {
    props.push({ forma: 'portal', u: 0, z: 1.7, esc: 1, fase: 0, lado: 1 });
}

function nuevoGrupo(capa) {
    const sala = SALAS[zonaActual] || SALAS[0];
    // La primera pieza de la sala pesa el doble: es la que le da carácter
    const i = Math.random() < 0.34 ? 0 : Math.floor(Math.random() * sala.length);
    const [forma, n, paso] = sala[i];
    const c = CARRILES[capa.carriles[Math.floor(Math.random() * capa.carriles.length)]];
    return {
        forma,
        carril: c,
        // Los de fuera van más apretados: como son pequeños, si no se ven cuatro gatos
        // Los de fuera van más apretados y en tiradas más largas: como son
        // pequeños, con la separación de los de dentro se ven cuatro gatos
        quedan: n + (c.esc < 0.8 ? 4 : 1),
        paso: paso * (c.esc < 0.8 ? 0.34 : 0.55)
    };
}

function alimentarProps(dt, speed) {
    // Marca de tiempo pendiente: se planta a los dos lados a la vez
    if (marcaPendiente) {
        for (const lado of [-1, 1]) {
            props.push({
                forma: 'marca', u: lado * CARRIL_CERCA, lado, z: 1.6,
                esc: 1, fase: 0, ritmo: 1, texto: marcaPendiente
            });
        }
        marcaPendiente = null;
    }
    if (props.length >= MAX_PROPS - 2) return;

    for (const capa of capas) {
        capa.dist += dt * speed;
        if (!capa.grupo) {
            if (capa.dist < capa.espera) continue;
            capa.grupo = nuevoGrupo(capa);
            capa.dist = 0;
        }
        if (capa.dist < capa.grupo.paso) continue;
        capa.dist = 0;

        // SIEMPRE por parejas: lo mismo a un lado que al otro, a la misma
        // distancia. La fase sí es distinta, para que no hagan el ejercicio a
        // la vez como un cuerpo de baile.
        for (const lado of [-1, 1]) {
            props.push({
                forma: capa.grupo.forma,
                u: lado * capa.grupo.carril.u,
                lado,
                z: 1.6,
                esc: capa.grupo.carril.esc,
                bruma: capa.grupo.carril.bruma,
                fase: Math.random() * 6.28,
                ritmo: 0.85 + Math.random() * 0.5
            });
        }

        if (--capa.grupo.quedan <= 0) {
            capa.grupo = null;
            capa.espera = 0.10 + Math.random() * 0.16;
            capa.dist = 0;
        }
    }
}

function moverProps(dt, speed) {
    for (let i = props.length - 1; i >= 0; i--) {
        props[i].z -= dt * speed;
        if (props[i].z < -0.45) props.splice(i, 1);
    }
}

/** Bloque con volumen: cara, canto y filo de luz de la sala. */
function bloque(x, gy, w, h, base, luz) {
    ctx.fillStyle = tono(base, 1);
    ctx.fillRect(x - w / 2, gy - h, w, h);
    ctx.fillStyle = tono(base, 1.5);
    ctx.fillRect(x - w / 2, gy - h, w, Math.max(1, h * 0.07));
    ctx.fillStyle = rgba(luz, 0.15);
    ctx.fillRect(x - w / 2, gy - h, Math.max(1, w * 0.10), h);
}

// ================= La gente =================
/**
 * Un cuerpo articulado sencillo. Cada ejercicio mueve lo suyo y deja el resto
 * quieto, que es lo que hace que se reconozca de un vistazo aunque pase rápido.
 */
function cuerpo(x, gy, u, p, luz, ejercicio) {
    const t = Math.sin(p.fase + performance.now() / 600 * p.ritmo);
    const k = (t + 1) / 2;                       // 0..1
    const alto = u * 0.84;
    const g = Math.max(1.6, alto * 0.08);
    const col = tono(COL.acero, 0.66);
    const claro = tono(COL.acero, 0.95);
    ctx.strokeStyle = col;
    ctx.lineWidth = g;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const cabeza = (cx, cy, r) => {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = col;
        ctx.fill();
    };
    const linea = (x1, y1, x2, y2) => {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
    };
    const barra = (cx, cy, medio, grosor) => {
        ctx.save();
        ctx.strokeStyle = claro;
        ctx.lineWidth = grosor;
        linea(cx - medio, cy, cx + medio, cy);
        ctx.fillStyle = tono(COL.acero, 0.5);
        for (const s of [-1, 1]) {
            ctx.beginPath();
            ctx.ellipse(cx + s * medio, cy, grosor * 0.5, grosor * 1.7, 0, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    };

    const A = alto;
    switch (ejercicio) {
        case 'press': {              // press de banca
            const y = gy - A * 0.34;
            bloque(x, gy, A * 0.62, A * 0.30, [34, 38, 48], luz);   // banco
            linea(x - A * 0.26, y, x + A * 0.22, y);                 // tronco tumbado
            linea(x - A * 0.20, y, x - A * 0.20, gy);                // piernas
            linea(x + A * 0.10, y, x + A * 0.10, gy);
            const sube = k * A * 0.20;
            linea(x - A * 0.05, y, x - A * 0.05, y - A * 0.16 - sube);
            barra(x - A * 0.05, y - A * 0.18 - sube, A * 0.28, g * 0.9);
            cabeza(x + A * 0.28, y - A * 0.06, A * 0.10);
            break;
        }
        case 'sentadilla': {
            const baja = k * A * 0.26;
            const cad = gy - A * 0.46 + baja;
            const hom = gy - A * 0.80 + baja;
            linea(x, cad, x, hom);
            linea(x, cad, x - A * 0.14, gy);
            linea(x, cad, x + A * 0.14, gy);
            barra(x, hom + A * 0.05, A * 0.30, g * 0.9);
            cabeza(x, hom - A * 0.11, A * 0.10);
            // El rack detrás
            ctx.strokeStyle = tono(COL.acero, 0.4);
            linea(x - A * 0.34, gy, x - A * 0.34, gy - A * 0.9);
            linea(x + A * 0.34, gy, x + A * 0.34, gy - A * 0.9);
            ctx.strokeStyle = col;
            break;
        }
        case 'militar': {            // press militar de pie
            const cad = gy - A * 0.46, hom = gy - A * 0.80;
            const sube = k * A * 0.26;
            linea(x, cad, x, hom);
            linea(x, cad, x - A * 0.10, gy);
            linea(x, cad, x + A * 0.10, gy);
            linea(x, hom, x - A * 0.13, hom - A * 0.10 - sube);
            linea(x, hom, x + A * 0.13, hom - A * 0.10 - sube);
            barra(x, hom - A * 0.14 - sube, A * 0.26, g * 0.85);
            cabeza(x, hom - A * 0.11, A * 0.10);
            break;
        }
        case 'curl': {               // curl con mancuernas
            const cad = gy - A * 0.46, hom = gy - A * 0.80;
            linea(x, cad, x, hom);
            linea(x, cad, x - A * 0.10, gy);
            linea(x, cad, x + A * 0.10, gy);
            for (const s of [-1, 1]) {
                const codo = [x + s * A * 0.14, hom + A * 0.16];
                const mano = [x + s * A * 0.16, hom + A * (0.30 - k * 0.26)];
                ctx.beginPath();
                ctx.moveTo(x + s * A * 0.06, hom + A * 0.02);
                ctx.lineTo(codo[0], codo[1]);
                ctx.lineTo(mano[0], mano[1]);
                ctx.stroke();
                ctx.fillStyle = tono(COL.acero, 0.5);
                ctx.fillRect(mano[0] - A * 0.06, mano[1] - A * 0.03, A * 0.12, A * 0.06);
            }
            cabeza(x, hom - A * 0.11, A * 0.10);
            break;
        }
        case 'correr': {             // corriendo a tu lado
            const cad = gy - A * 0.46, hom = gy - A * 0.80;
            linea(x, cad, x, hom);
            linea(x, cad, x - A * 0.16 * t, gy);
            linea(x, cad, x + A * 0.16 * t, gy);
            linea(x, hom + A * 0.04, x + A * 0.16 * t, hom + A * 0.22);
            linea(x, hom + A * 0.04, x - A * 0.16 * t, hom + A * 0.22);
            cabeza(x, hom - A * 0.11, A * 0.10);
            break;
        }
        case 'posar': {              // haciendo poses
            const cad = gy - A * 0.46, hom = gy - A * 0.80;
            const abre = 0.6 + k * 0.5;
            linea(x, cad, x, hom);
            linea(x, cad, x - A * 0.13, gy);
            linea(x, cad, x + A * 0.13, gy);
            for (const s of [-1, 1]) {
                ctx.beginPath();
                ctx.moveTo(x + s * A * 0.06, hom + A * 0.02);
                ctx.lineTo(x + s * A * 0.24 * abre, hom + A * 0.04);
                ctx.lineTo(x + s * A * 0.22 * abre, hom - A * 0.16);
                ctx.stroke();
            }
            cabeza(x, hom - A * 0.11, A * 0.10);
            break;
        }
        case 'foto': {               // con el móvil, y su flash
            const cad = gy - A * 0.46, hom = gy - A * 0.80;
            linea(x, cad, x, hom);
            linea(x, cad, x - A * 0.09, gy);
            linea(x, cad, x + A * 0.09, gy);
            linea(x, hom + A * 0.03, x + A * 0.16, hom - A * 0.06);
            ctx.fillStyle = tono(COL.acero, 0.8);
            ctx.fillRect(x + A * 0.13, hom - A * 0.14, A * 0.07, A * 0.12);
            cabeza(x, hom - A * 0.11, A * 0.10);
            // Fogonazo cada dos por tres
            const destello = Math.sin(p.fase * 7 + performance.now() / 300);
            if (destello > 0.93) {
                glow('blanco', x + A * 0.17, hom - A * 0.08, A * 2.4, 0.85);
            }
            break;
        }
        case 'nadar': {              // brazada en la calle
            const y = gy - A * 0.12;
            linea(x - A * 0.30, y, x + A * 0.24, y);
            const brazo = k * Math.PI;
            ctx.beginPath();
            ctx.moveTo(x + A * 0.10, y);
            ctx.lineTo(x + A * 0.10 + Math.cos(brazo) * A * 0.24, y - Math.sin(brazo) * A * 0.24);
            ctx.stroke();
            cabeza(x + A * 0.28, y - A * 0.03, A * 0.09);
            break;
        }
        case 'boxear': {             // sombra, con guardia
            const cad = gy - A * 0.46, hom = gy - A * 0.80;
            const golpe = Math.max(0, t) * A * 0.22;
            linea(x, cad, x, hom);
            linea(x, cad, x - A * 0.13, gy);
            linea(x, cad, x + A * 0.13, gy);
            linea(x, hom + A * 0.03, x + A * 0.10 + golpe, hom - A * 0.04);
            linea(x, hom + A * 0.03, x - A * 0.10, hom - A * 0.08);
            ctx.fillStyle = tono(COL.rojo, 0.75);
            ctx.beginPath();
            ctx.arc(x + A * 0.12 + golpe, hom - A * 0.04, A * 0.07, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(x - A * 0.12, hom - A * 0.08, A * 0.07, 0, Math.PI * 2);
            ctx.fill();
            cabeza(x, hom - A * 0.11, A * 0.10);
            break;
        }
        case 'botar': {              // botando el balón
            const cad = gy - A * 0.46, hom = gy - A * 0.80;
            const bote = Math.abs(Math.sin(p.fase + performance.now() / 260 * p.ritmo));
            linea(x, cad, x, hom);
            linea(x, cad, x - A * 0.11, gy);
            linea(x, cad, x + A * 0.11, gy);
            linea(x, hom + A * 0.03, x + A * 0.17, hom + A * 0.20);
            ctx.fillStyle = 'rgb(178,96,44)';
            ctx.beginPath();
            ctx.arc(x + A * 0.19, gy - A * (0.06 + bote * 0.26), A * 0.09, 0, Math.PI * 2);
            ctx.fill();
            cabeza(x, hom - A * 0.11, A * 0.10);
            break;
        }
        default: {                   // de pie, mirando
            const cad = gy - A * 0.46, hom = gy - A * 0.80;
            linea(x, cad, x, hom);
            linea(x, cad, x - A * 0.10, gy);
            linea(x, cad, x + A * 0.10, gy);
            linea(x, hom + A * 0.03, x - A * 0.12, hom + A * 0.22);
            linea(x, hom + A * 0.03, x + A * 0.12, hom + A * 0.22);
            cabeza(x, hom - A * 0.11, A * 0.10);
        }
    }
}

/** Pórtico de cambio de sala: lo cruzas y ya estás en el otro sitio. */
function portal(p) {
    const s = scaleAt(p.z);
    const gy = yAt(p.z);
    const u = unitAt(p.z);
    const luz = ZONAS[zonaActual].acento;
    const izq = xAt(-1.62, p.z);
    const der = xAt(1.62, p.z);
    const alto = u * 2.6;
    const jamba = Math.max(2, (der - izq) * 0.05);

    ctx.fillStyle = tono([24, 28, 36], 1);
    ctx.fillRect(izq - jamba, gy - alto, jamba, alto);
    ctx.fillRect(der, gy - alto, jamba, alto);
    ctx.fillRect(izq - jamba, gy - alto, der - izq + jamba * 2, alto * 0.14);

    ctx.strokeStyle = rgba(luz, 0.95);
    ctx.lineWidth = Math.max(1.5, 3 * s);
    ctx.strokeRect(izq - jamba, gy - alto, der - izq + jamba * 2, alto);
    glow('zona' + zonaActual, (izq + der) / 2, gy - alto * 0.92, (der - izq) * 1.4, 0.5);
}

/**
 * Cuánto se come la niebla a algo que está a distancia z. Es la perspectiva
 * atmosférica de toda la vida: lo lejano pierde contraste y se va hacia el
 * color del aire. Sin esto el decorado compite con los obstáculos y la pista
 * se vuelve ilegible, que es el error más típico de este tipo de juegos.
 */
function niebla(z) {
    return Math.min(0.82, Math.max(0, (z - 0.05) / 1.5) * 0.95);
}

/**
 * Sombra de contacto. Es el detalle que más barato ancla un objeto al suelo:
 * sin ella todo parece pegado con celo sobre el fondo, por bien dibujado que
 * esté. Se oscurece justo donde la pieza toca el suelo.
 */
function sombraContacto(x, gy, ancho, fuerza = 1) {
    const g = ctx.createRadialGradient(x, gy, 0, x, gy, ancho);
    g.addColorStop(0, `rgba(0,0,0,${0.55 * fuerza})`);
    g.addColorStop(0.6, `rgba(0,0,0,${0.22 * fuerza})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, gy, ancho, ancho * 0.26, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function drawProp(p) {
    if (p.z < -0.4 || p.z > 1.75) return;
    if (p.forma === 'portal') { portal(p); return; }

    const s = scaleAt(p.z);
    const x = xAt(p.u, p.z);
    if (x < -W * 0.5 || x > W * 1.5) return;
    const gy = yAt(p.z);
    const u = unitAt(p.z) * p.esc;
    const luz = ZONAS[zonaActual].acento;
    const M = matZona();
    const metal = M.estructura;
    const oscuro = M.detalle;

    // El lado izquierdo se pinta EN ESPEJO del derecho. Si no, la bici mira
    // para el mismo sitio en los dos lados y el conjunto no cuadra.
    ctx.save();
    // Perspectiva atmosférica: lo lejano pierde presencia en vez de competir
    // con la pista. Es lo que separa el primer plano del fondo.
    if (p.forma !== 'portal' && p.forma !== 'marca') {
        const bruma = Math.min(0.92, niebla(p.z) * (p.bruma || 1));
        const visible = 1 - bruma * 0.72;
        // Si ya casi no se ve, ni se dibuja: son piezas de los carriles de
        // fuera y a esa distancia no aportan nada más que trabajo
        if (visible < 0.13) { ctx.restore(); return; }
        ctx.globalAlpha = visible;
        sombraContacto(x, gy, u * 0.72, visible * 0.8);
    }
    if (p.lado < 0) {
        ctx.translate(x, 0);
        ctx.scale(-1, 1);
        ctx.translate(-x, 0);
    }

    switch (p.forma) {
        // ---- Gente ----
        case 'press': case 'sentadilla': case 'militar': case 'curl':
        case 'corredor': case 'posando': case 'foto': case 'nadador':
        case 'boxeador': case 'jugador': case 'publico': case 'socorrista': {
            const mapa = {
                press: 'press', sentadilla: 'sentadilla', militar: 'militar', curl: 'curl',
                corredor: 'correr', posando: 'posar', foto: 'foto', nadador: 'nadar',
                boxeador: 'boxear', jugador: 'botar', publico: 'quieto', socorrista: 'quieto'
            };
            if (p.forma === 'socorrista') bloque(x, gy, u * 0.3, u * 0.9, metal, luz);
            cuerpo(x, gy, u, p, luz, mapa[p.forma]);
            break;
        }
        // ---- Máquinas de cardio ----
        case 'bici':
            bloque(x, gy, u * 0.5, u * 0.14, oscuro, luz);
            ctx.strokeStyle = tono(metal, 1);
            ctx.lineWidth = Math.max(1.5, u * 0.06);
            ctx.beginPath();
            ctx.arc(x - u * 0.16, gy - u * 0.24, u * 0.2, 0, Math.PI * 2);
            ctx.stroke();
            bloque(x + u * 0.06, gy - u * 0.14, u * 0.09, u * 0.72, metal, luz);
            bloque(x + u * 0.06, gy - u * 0.86, u * 0.42, u * 0.09, metal, luz);
            bloque(x - u * 0.1, gy - u * 0.5, u * 0.3, u * 0.1, oscuro, luz);
            break;
        case 'cinta':
            bloque(x, gy, u * 0.62, u * 0.16, oscuro, luz);
            bloque(x - u * 0.26, gy - u * 0.16, u * 0.1, u * 0.9, metal, luz);
            bloque(x + u * 0.26, gy - u * 0.16, u * 0.1, u * 0.9, metal, luz);
            bloque(x, gy - u * 1.0, u * 0.62, u * 0.22, metal, luz);
            break;
        case 'escaleraMec':
            for (let i = 0; i < 5; i++) {
                bloque(x, gy - i * u * 0.2, u * (0.7 - i * 0.06), u * 0.2, metal, luz);
            }
            bloque(x + u * 0.4, gy, u * 0.08, u * 1.3, metal, luz);
            break;
        // ---- Crossfit ----
        case 'cajon':
            bloque(x, gy, u * 0.62, u * 0.6, oscuro, luz);
            bloque(x, gy - u * 0.6, u * 0.5, u * 0.45, oscuro, luz);
            break;
        case 'neumatico':
            ctx.fillStyle = 'rgb(20,20,23)';
            ctx.beginPath();
            ctx.ellipse(x, gy - u * 0.34, u * 0.4, u * 0.36, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = 'rgb(11,11,13)';
            ctx.beginPath();
            ctx.ellipse(x, gy - u * 0.34, u * 0.17, u * 0.15, 0, 0, Math.PI * 2);
            ctx.fill();
            break;
        case 'kettlebell':
            ctx.fillStyle = tono(oscuro, 1.3);
            ctx.beginPath();
            ctx.arc(x, gy - u * 0.2, u * 0.2, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = tono(oscuro, 1.8);
            ctx.lineWidth = Math.max(1.5, u * 0.06);
            ctx.beginPath();
            ctx.arc(x, gy - u * 0.42, u * 0.13, Math.PI, Math.PI * 2);
            ctx.stroke();
            break;
        case 'anillas':
            ctx.strokeStyle = tono(metal, 0.8);
            ctx.lineWidth = Math.max(1, u * 0.035);
            for (const s2 of [-1, 1]) {
                ctx.beginPath();
                ctx.moveTo(x + s2 * u * 0.18, gy - u * 2.2);
                ctx.lineTo(x + s2 * u * 0.18, gy - u * 0.9);
                ctx.stroke();
                ctx.strokeStyle = 'rgb(120,86,44)';
                ctx.lineWidth = Math.max(1.5, u * 0.05);
                ctx.beginPath();
                ctx.arc(x + s2 * u * 0.18, gy - u * 0.78, u * 0.13, 0, Math.PI * 2);
                ctx.stroke();
                ctx.strokeStyle = tono(metal, 0.8);
                ctx.lineWidth = Math.max(1, u * 0.035);
            }
            break;
        case 'cuerdaBatalla':
            bloque(x, gy, u * 0.24, u * 0.3, metal, luz);
            ctx.strokeStyle = 'rgb(58,48,34)';
            ctx.lineWidth = Math.max(2, u * 0.07);
            for (const s2 of [-1, 1]) {
                ctx.beginPath();
                ctx.moveTo(x, gy - u * 0.28);
                ctx.quadraticCurveTo(x + s2 * u * 0.4, gy - u * 0.05, x + s2 * u * 0.75, gy - u * 0.2);
                ctx.stroke();
            }
            break;
        // ---- Posing ----
        case 'podio':
            bloque(x, gy, u * 0.9, u * 0.34, metal, luz);
            bloque(x, gy - u * 0.34, u * 0.7, u * 0.22, metal, luz);
            break;
        // ---- Atletismo ----
        case 'valla':
            bloque(x - u * 0.3, gy, u * 0.07, u * 0.5, metal, luz);
            bloque(x + u * 0.3, gy, u * 0.07, u * 0.5, metal, luz);
            bloque(x, gy - u * 0.44, u * 0.7, u * 0.1, oscuro, luz);
            break;
        case 'foso':
            ctx.fillStyle = 'rgb(120,104,74)';
            ctx.beginPath();
            ctx.ellipse(x, gy - u * 0.04, u * 1.1, u * 0.16, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = tono(COL.blanco, 0.5);
            ctx.lineWidth = Math.max(1, u * 0.03);
            ctx.stroke();
            break;
        case 'grada':
            for (let i = 0; i < 4; i++) {
                bloque(x, gy - i * u * 0.22, u * (1.5 - i * 0.18), u * 0.22, metal, luz);
            }
            break;
        // ---- Piscina ----
        case 'poyete':
            bloque(x, gy, u * 0.44, u * 0.44, oscuro, luz);
            bloque(x, gy - u * 0.44, u * 0.52, u * 0.08, metal, luz);
            break;
        // ---- Baloncesto ----
        case 'canasta':
            bloque(x, gy, u * 0.12, u * 1.7, metal, luz);
            bloque(x, gy - u * 1.7, u * 0.7, u * 0.42, oscuro, luz);
            ctx.strokeStyle = 'rgb(160,98,46)';
            ctx.lineWidth = Math.max(1.5, 3 * s);
            ctx.beginPath();
            ctx.arc(x, gy - u * 1.24, u * 0.16, 0, Math.PI);
            ctx.stroke();
            break;
        // ---- Ring ----
        case 'saco':
            ctx.strokeStyle = tono(metal, 0.8);
            ctx.lineWidth = Math.max(1, u * 0.04);
            ctx.beginPath();
            ctx.moveTo(x, gy - u * 2.2); ctx.lineTo(x, gy - u * 1.15);
            ctx.stroke();
            bloque(x, gy - u * 0.35, u * 0.3, u * 0.8, oscuro, luz);
            break;
        case 'esquina':
            bloque(x, gy, u * 0.16, u * 1.35, [54, 28, 34], luz);
            ctx.strokeStyle = rgba(COL.rojo, 0.55);
            ctx.lineWidth = Math.max(1.5, 3 * s);
            for (let i = 0; i < 3; i++) {
                const y = gy - u * (0.45 + i * 0.32);
                ctx.beginPath();
                ctx.moveTo(x - u * 1.2, y); ctx.lineTo(x + u * 1.2, y);
                ctx.stroke();
            }
            break;
        // ---- Comunes ----
        case 'rack':
            bloque(x - u * 0.26, gy, u * 0.12, u * 1.5, metal, luz);
            bloque(x + u * 0.26, gy, u * 0.12, u * 1.5, metal, luz);
            bloque(x, gy - u * 1.42, u * 0.64, u * 0.12, metal, luz);
            bloque(x, gy - u * 0.7, u * 0.64, u * 0.08, oscuro, luz);
            break;
        case 'taquillas':
            for (let i = 0; i < 3; i++) {
                bloque(x - u * 0.5 + i * u * 0.5, gy, u * 0.46, u * 1.55, metal, luz);
            }
            break;
    }
    ctx.restore();

    // La marca de tiempo va fuera del espejo: el texto no se voltea
    if (p.forma === 'marca') {
        const w = u * 1.05, h = u * 0.42;
        const y = gy - u * 1.25;
        bloque(x, gy, u * 0.10, u * 1.25, metal, luz);
        ctx.fillStyle = 'rgb(16,19,25)';
        ctx.fillRect(x - w / 2, y - h, w, h);
        ctx.strokeStyle = rgba(luz, 0.9);
        ctx.lineWidth = Math.max(1, 2 * s);
        ctx.strokeRect(x - w / 2, y - h, w, h);
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `800 ${Math.max(7, h * 0.62)}px Outfit, sans-serif`;
        ctx.fillStyle = tono(luz, 1.2);
        ctx.fillText(p.texto || '', x, y - h / 2);
        ctx.restore();
    }
}

const _ordenProps = [];
function drawProps() {
    // Mismo array reutilizado, igual que con los obstáculos
    _ordenProps.length = 0;
    for (const p of props) _ordenProps.push(p);
    _ordenProps.sort((a, b) => b.z - a.z);
    for (const p of _ordenProps) drawProp(p);
}

// ================= Luz de la sala =================
/**
 * Iluminación de mentira, pero que sí baña TODO.
 *
 * En canvas 2D no hay luces ni normales, así que no se puede iluminar objeto a
 * objeto. El truco es pintar la escena entera y luego pasarle por encima una
 * capa del color de la sala en modo de mezcla: el personaje y los obstáculos se
 * tiñen igual que el decorado, porque para el navegador ya son los mismos
 * píxeles. No es luz real, pero es lo que hace que la piscina se sienta azul y
 * el ring rojo hasta en la cara del muñeco.
 *
 * Cada sala trae de dónde viene la luz, cuánto tiñe y cuánta niebla hay.
 */
const LUZ = [
    { dir: 0, tinte: 0.10, niebla: 0.18 },   // pesas: cenital y neutra
    { dir: 0, tinte: 0.16, niebla: 0.22 },   // cardio
    { dir: -1, tinte: 0.20, niebla: 0.16 },  // box: lateral y dura
    { dir: 0, tinte: 0.09, niebla: 0.26 },   // espejos
    { dir: 1, tinte: 0.15, niebla: 0.20 },   // atletismo
    { dir: 0, tinte: 0.24, niebla: 0.34 },   // piscina: lo baña todo
    { dir: -1, tinte: 0.14, niebla: 0.18 },  // baloncesto
    { dir: 0, tinte: 0.22, niebla: 0.14 }    // ring: focos al centro
];

const luzSala = () => LUZ[zonaActual] || LUZ[0];

let capaLuz = null;
function pintarLuz() {
    if (!calidadAlta) return;
    const L = luzSala();
    const c = acento();

    // 1. Tinte general en modo mezcla: aquí es donde la luz "toca" al muñeco
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.fillStyle = rgba(c, L.tinte * 3.2);
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    // 2. Niebla de profundidad: lo lejano se lava hacia el color de la sala
    if (!capaLuz || capaLuz.w !== W || capaLuz.h !== H) {
        capaLuz = { w: W, h: H, canvas: offscreen(W, H) };
    }
    const g = ctx.createLinearGradient(0, H * HORIZON, 0, H * 0.78);
    g.addColorStop(0, rgba(c, L.niebla * 0.5));
    g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, H * HORIZON, W, H * 0.78 - H * HORIZON);

}

// ================= Bloom con umbral =================
/**
 * El bloom barato de tutorial hace brillar TODO y deja la imagen lechosa. El
 * bueno solo hace brillar lo que de verdad es luz. Como en canvas 2D no hay
 * shaders, el umbral se saca con un truco viejo: copiar la escena y
 * multiplicarla por sí misma. Al elevar los valores al cuadrado, lo oscuro se
 * hunde y solo sobrevive lo brillante. Eso se difumina y se suma encima.
 *
 * Se hace a un cuarto de resolución porque el desenfoque no necesita detalle,
 * y así cuesta una fracción.
 */
let bloomLienzo = null;
let bloomCtx = null;

/**
 * Calidad gráfica. En BAJA se van los adornos que cuestan trabajo de GPU
 * (bloom y tinte de sala a pantalla completa) y se queda el juego entero:
 * misma jugabilidad, mismos obstáculos, misma legibilidad.
 */
let calidadAlta = true;
export function setCalidad(alta) { calidadAlta = !!alta; }
export const calidad = () => calidadAlta;

function pasadaBloom(canvasFuente) {
    if (!calidadAlta) return;
    const bw = Math.max(1, Math.round(W / 4));
    const bh = Math.max(1, Math.round(H / 4));
    if (!bloomLienzo || bloomLienzo.width !== bw) {
        bloomLienzo = offscreen(bw, bh);
        bloomCtx = bloomLienzo.getContext('2d');
    }

    bloomCtx.globalCompositeOperation = 'source-over';
    bloomCtx.clearRect(0, 0, bw, bh);
    bloomCtx.drawImage(canvasFuente, 0, 0, bw, bh);
    // Al cuadrado: el umbral. Lo medio tirando a oscuro desaparece.
    bloomCtx.globalCompositeOperation = 'multiply';
    bloomCtx.drawImage(bloomLienzo, 0, 0);
    bloomCtx.globalCompositeOperation = 'multiply';
    bloomCtx.drawImage(bloomLienzo, 0, 0);
    bloomCtx.globalCompositeOperation = 'source-over';
    if (bloomCtx.filter !== undefined) {
        bloomCtx.filter = 'blur(2px)';
        bloomCtx.drawImage(bloomLienzo, 0, 0);
        bloomCtx.filter = 'none';
    }

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.8;
    ctx.drawImage(bloomLienzo, 0, 0, W, H);
    ctx.restore();
}

// ================= Grano de película =================
/** Ruido finísimo. Mata el bandeado de los degradados y unifica la imagen. */
function buildGrano() {
    const n = 128;
    const c = offscreen(n, n);
    const g = c.getContext('2d');
    const img = g.createImageData(n, n);
    for (let i = 0; i < img.data.length; i += 4) {
        const v = 118 + Math.random() * 20;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
}

// ================= Fotograma =================
const ordenados = [];   // reutilizado en cada fotograma, no se reasigna nunca

export function renderFrame(game, now, dt) {
    if (!ctx) return;

    // Muy poco seguimiento: lo justo para dar profundidad sin desencuadrar el
    // gimnasio, que está montado simétrico y se nota si se descentra
    camX += (laneU(game.laneVisual) * 0.10 - camX) * Math.min(1, dt * 6);

    shake *= Math.pow(0.001, dt);
    if (shake < 0.3) shake = 0;
    hitFlash *= Math.pow(0.004, dt);
    flashPerfecto *= Math.pow(0.0008, dt);
    punch *= Math.pow(0.0015, dt);
    if (punch < 0.005) punch = 0;
    barrido = Math.max(0, barrido - dt / 0.9);

    ctx.save();
    // Golpe de cámara: un tirón de zoom desde el centro que se relaja solo
    if (punch > 0) {
        const k = 1 + punch * 0.045;
        ctx.translate(W / 2, H * 0.62);
        ctx.scale(k, k);
        ctx.translate(-W / 2, -H * 0.62);
    }
    if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

    // Fondo, fundiendo la zona anterior con la nueva si acaba de cambiar
    fundido = Math.min(1, fundido + dt / 1.3);
    const bd = layers.backdrop;
    const off = -((bd ? bd.width : W * 1.25) - W) / 2 - camX * W * 0.10;
    if (layers.backdropPrev && fundido < 1) ctx.drawImage(layers.backdropPrev, off, 0);
    if (bd) {
        ctx.globalAlpha = fundido;
        ctx.drawImage(bd, off, 0);
        ctx.globalAlpha = 1;
    }

    // Decorado de los lados: se alimenta y se mueve antes de pintar el suelo
    alimentarProps(dt, game.speed);
    moverProps(dt, game.speed);

    // La pared se lava hacia el color del aire. Comprimir su rango es lo que
    // la manda al fondo: la vista deja de irse allí y se queda en la pista.
    {
        const c = acento();
        const aire = ctx.createLinearGradient(0, 0, 0, H * HORIZON);
        aire.addColorStop(0, rgba(c, 0.42));
        aire.addColorStop(1, rgba(c, 0.58));
        ctx.fillStyle = aire;
        ctx.fillRect(0, 0, W, H * HORIZON + 2);
    }

    drawGround(game.roadPhase, now);
    drawProps();
    drawSpeedLines(game.speed);
    // Se reutiliza el mismo array en vez de crear uno nuevo cada fotograma:
    // era, con diferencia, lo que más basura generaba del bucle de dibujo
    ordenados.length = 0;
    for (const o of game.obstacles) ordenados.push(o);
    ordenados.sort((a, b) => b.z - a.z);
    for (const o of ordenados) drawObstacle(o, now);
    drawRunner(game, now);

    // Polvillo que levantan los pies al correr. Poco y constante: si se pasa,
    // ensucia; si no está, el muñeco parece que flota.
    if (!game.dying && Math.random() < dt * 26) {
        addParticle({
            x: xAt(laneU(game.laneVisual), 0) + (Math.random() - 0.5) * unitAt(0) * 0.3,
            y: yAt(0) - Math.random() * unitAt(0) * 0.04,
            vx: (Math.random() - 0.5) * 70,
            vy: -18 - Math.random() * 34,
            life: 0.4 + Math.random() * 0.4,
            age: 0, size: 1.5 + Math.random() * 2,
            color: 'acero', grav: 130
        });
    }

    // La luz de la sala va DESPUÉS de todo, para que bañe también al muñeco
    pintarLuz();

    // Barrido de sala nueva: una banda de luz que cruza la pantalla
    if (barrido > 0) {
        const p = 1 - barrido;
        const bx = -W * 0.4 + p * W * 1.8;
        const g = ctx.createLinearGradient(bx - W * 0.3, 0, bx + W * 0.3, 0);
        const c = acento();
        g.addColorStop(0, rgba(c, 0));
        g.addColorStop(0.5, rgba(c, 0.22 * barrido));
        g.addColorStop(1, rgba(c, 0));
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
    }

    updateParticles(dt);
    drawParticles();
    drawPopups(dt);

    ctx.restore();

    if (flashPerfecto > 0.01) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = rgba(COL.blanco, 0.22 * flashPerfecto);
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
    }
    if (hitFlash > 0.01) {
        ctx.fillStyle = rgba(COL.rojo, 0.32 * hitFlash);
        ctx.fillRect(0, 0, W, H);
    }

    // ---- Cadena de post-proceso, en el orden en que se hace de verdad ----

    // 1. Bloom con umbral: solo brilla lo que es luz
    pasadaBloom(ctx.canvas);

    // 3. Viñeta
    if (layers.vignette) ctx.drawImage(layers.vignette, 0, 0);

}

export function renderIdle() {
    renderFrame({
        laneVisual: 0, lane: 0, obstacles: [], roadPhase: 0, speed: 0.45,
        runPhase: 0, jumpUntil: 0, duckUntil: 0, lastHit: -9999,
        jumpMs: 620, dying: 0, deathMs: 1100
    }, performance.now(), 0.016);
}
