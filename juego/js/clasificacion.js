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

import { sesion } from '/js/cuenta.js?v=13';

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
        const r = await rpc('runner_guardar_marca', { p_segundos: Math.round(segundos * 100) / 100 });
        if (r?.[0]?.mejorada) pintarTop();
    } catch { /* la partida ya está guardada en local; esto es un extra */ }
};

// ═════════════════════ Pintar la tabla ═════════════════════

async function pintarTop() {
    const cuerpo = $('topCuerpo');
    const aviso = $('topAviso');
    if (!cuerpo) return;

    aviso.textContent = 'Cargando…';
    let filas;
    try {
        filas = await rpc('runner_top', { p_limite: 20 });
    } catch {
        aviso.textContent = 'No se ha podido cargar la clasificación.';
        return;
    }

    cuerpo.textContent = '';
    if (!filas.length) {
        aviso.textContent = 'Todavía no hay marcas. Sé el primero.';
        // Con la tabla vacía es CUANDO más falta hace decir que entres: si se
        // saliera aquí, quien no tiene cuenta no vería nunca la invitación
        await pintarMiPuesto([]);
        return;
    }
    aviso.textContent = '';

    for (const f of filas) {
        const tr = document.createElement('tr');
        if (f.soy_yo) tr.className = 'yo';

        const puesto = document.createElement('td');
        puesto.className = 'puesto';
        // Las tres primeras se distinguen con la medalla, no con color solo
        puesto.textContent = f.puesto === 1 ? '🥇' : f.puesto === 2 ? '🥈' : f.puesto === 3 ? '🥉' : f.puesto;

        const quien = document.createElement('td');
        quien.className = 'quien';
        const emoji = document.createElement('span');
        emoji.className = 'top-emoji';
        emoji.textContent = f.emoji || '💪';
        const nombre = document.createElement('span');
        // Se enseña el usuario, que es como se identifica la gente en la app
        nombre.textContent = f.usuario ? '@' + f.usuario : (f.nombre || 'Anónimo');
        quien.append(emoji, nombre);

        const marca = document.createElement('td');
        marca.className = 'marca';
        marca.textContent = tiempo(f.segundos);

        const cuando = document.createElement('td');
        cuando.className = 'cuando';
        cuando.textContent = new Date(f.conseguido).toLocaleDateString('es-ES',
            { day: '2-digit', month: 'short' });

        tr.append(puesto, quien, marca, cuando);
        cuerpo.append(tr);
    }

    await pintarMiPuesto(filas);
}

/** Si no sales en el top, al menos que sepas por dónde andas. */
async function pintarMiPuesto(filas) {
    const caja = $('miPuesto');
    if (!caja) return;
    caja.hidden = true;

    const s = await sesion();
    if (!s) {
        caja.hidden = false;
        caja.className = 'mi-puesto sin-cuenta';
        caja.textContent = 'Entra con tu cuenta para que tu marca cuente en la tabla.';
        return;
    }
    if (filas.some((f) => f.soy_yo)) return;   // ya sale arriba

    try {
        const r = await rpc('runner_mi_puesto');
        if (!r?.length) {
            caja.hidden = false;
            caja.className = 'mi-puesto';
            caja.textContent = 'Aún no tienes marca. Juega una partida y aparecerás aquí.';
            return;
        }
        const { puesto, segundos, total } = r[0];
        caja.hidden = false;
        caja.className = 'mi-puesto';
        caja.textContent = `Vas ${puesto}º de ${total}, con ${tiempo(segundos)}.`;
    } catch { /* sin puesto, sin aviso */ }
}

$('topRecargar')?.addEventListener('click', pintarTop);
pintarTop();
