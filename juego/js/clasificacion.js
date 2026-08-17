/**
 * La clasificación del Runner.
 *
 * Una fila por persona, nunca dos: la tabla tiene el usuario como clave
 * primaria, así que "mejorar tu marca" es actualizar tu fila y el top no puede
 * repetir a nadie. Eso lo garantiza la base de datos, no este fichero.
 *
 * El top se pide con una función del servidor y no leyendo la tabla, por dos
 * razones: la RLS de `profiles` no deja ver el nombre de desconocidos, y una
 * tabla abierta a lectura sería descargable entera con la clave pública.
 */

import { sesion } from '/js/cuenta.js?v=22';

const SUPABASE_URL = 'https://datuqilcshjvapujdool.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRhdHVxaWxjc2hqdmFwdWpkb29sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwNDgxMzIsImV4cCI6MjA5NDYyNDEzMn0.q6AZirRR1UsKKdkxvnmlmPDVQx09T-FckLl03aRh5Gw';

const $ = (id) => document.getElementById(id);

/** Llama a una función del servidor, con el token si hay sesión. */
async function rpc(nombre, cuerpo = {}) {
    const s = await sesion();
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${nombre}`, {
        method: 'POST',
        headers: {
            apikey: SUPABASE_ANON,
            Authorization: `Bearer ${s?.access_token || SUPABASE_ANON}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(cuerpo)
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

const tiempo = (seg) => {
    const n = Number(seg) || 0;
    return `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`;
};

// ═════════════════════ Subir tu marca ═════════════════════

/**
 * La llama el juego al terminar. Silenciosa a propósito: si no hay sesión o
 * falla la red, no es momento de dar la lata — acabas de perder.
 */
window.__subirMarca = async (segundos) => {
    try {
        const s = await sesion();
        if (!s) return;
        await rpc('runner_guardar_marca', { p_segundos: Math.round(segundos * 100) / 100 });
    } catch { /* la partida ya está guardada en local; esto es un extra */ }
};

/** Lo usa el resumen para decidir si ofrecer guardar la marca. */
window.__hayCuenta = async () => !!(await sesion().catch(() => null));

// ═════════════════════ La clasificación ═════════════════════

/**
 * Pinta el podio, unos puntos suspensivos y tu vecindario.
 *
 * Con mucha gente un top de veinte no dice nada si vas el 253. Lo que engancha
 * es ver quién tienes justo delante. El corte lo marca el servidor con la
 * columna `grupo`, y los puestos salen todos del MISMO recuento: pidiéndolo en
 * dos viajes podrían no cuadrar entre sí.
 */
async function pintarEn(cuerpo, cabecera, aviso, opciones = {}) {
    const top = opciones.top ?? 3;
    const ventana = opciones.ventana ?? 1;

    let filas, total;
    try {
        [filas, total] = await Promise.all([
            rpc('runner_clasificacion', { p_top: top, p_ventana: ventana }),
            rpc('runner_cuantos')
        ]);
    } catch {
        if (aviso) aviso.textContent = 'No se ha podido cargar la clasificación.';
        return false;
    }

    if (!filas.length) {
        if (aviso) aviso.textContent = 'Todavía no hay marcas. Sé el primero.';
        return false;
    }
    if (aviso) aviso.textContent = '';

    cuerpo.textContent = '';
    let anterior = 0;
    for (const f of filas) {
        // Si hay hueco entre un puesto y el siguiente, se dice con puntos
        if (anterior && f.puesto > anterior + 1) {
            const hueco = document.createElement('tr');
            hueco.className = 'hueco';
            const td = document.createElement('td');
            td.colSpan = 3;
            td.textContent = '⋯';
            hueco.append(td);
            cuerpo.append(hueco);
        }
        anterior = f.puesto;

        const tr = document.createElement('tr');
        if (f.soy_yo) tr.className = 'yo';
        const p = document.createElement('td');
        p.className = 'puesto';
        p.textContent = f.puesto;
        const q = document.createElement('td');
        q.textContent = f.usuario ? '@' + f.usuario : (f.nombre || 'Anónimo');
        const m = document.createElement('td');
        m.className = 'marca';
        m.textContent = tiempo(f.segundos);
        tr.append(p, q, m);
        cuerpo.append(tr);
    }

    if (cabecera) {
        const mio = filas.find((f) => f.soy_yo);
        cabecera.total.textContent = total === 1 ? '1 jugador' : `${total} jugadores`;
        cabecera.puesto.textContent = mio ? `Vas ${mio.puesto}º` : '';
    }
    return true;
}

/** La tabla del menú, con más vecinos porque hay sitio de sobra. */
window.__pintarTabla = async () => {
    await pintarEn($('tablaCuerpo'), { total: $('tablaTotal'), puesto: $('tablaMiPuesto') },
                   $('tablaAviso'), { top: 3, ventana: 2 });
    pintarStats();
};

/** El marcador del resumen: más corto, que ahí solo quieres el titular. */
window.__marcadorFinal = async () => {
    const caja = $('marcadorFinal');
    if (!caja) return;
    const ok = await pintarEn($('marcadorCuerpo'),
        { total: { textContent: '' }, puesto: $('marcadorMiPuesto') }, null, { top: 3, ventana: 1 });
    caja.hidden = !ok;
};

/** Tus números de duelo. Sin sesión no hay caja: no habría nada que contar. */
async function pintarStats() {
    const caja = $('misStats');
    if (!caja) return;
    caja.hidden = true;
    if (!(await sesion().catch(() => null))) return;

    let r;
    try { r = await rpc('runner_mis_stats'); } catch { return; }
    if (!r?.length) return;

    const { duelos, victorias, derrotas } = r[0];
    $('stDuelos').textContent = duelos ?? 0;
    $('stVictorias').textContent = victorias ?? 0;
    $('stDerrotas').textContent = derrotas ?? 0;
    // El ratio solo dice algo cuando hay partidas: con cero sería un 0 % falso
    $('stRatio').textContent = duelos > 0
        ? Math.round((victorias / duelos) * 100) + '%'
        : '—';
    caja.hidden = false;
}


