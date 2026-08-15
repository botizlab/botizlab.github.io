/**
 * Panel de mensajes de la web.
 *
 * Aquí NO hay nada que proteger por esconderlo: la página es pública y su
 * código también. Lo que decide quién ve los mensajes son las políticas de
 * Supabase — la tabla `mensajes_web` solo se puede leer si `es_admin()`
 * devuelve cierto, y `admins` no se puede tocar con la clave pública. Si entra
 * alguien que no eres tú, verá una lista vacía por mucho que mire el código.
 */

const SUPABASE_URL = 'https://datuqilcshjvapujdool.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRhdHVxaWxjc2hqdmFwdWpkb29sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwNDgxMzIsImV4cCI6MjA5NDYyNDEzMn0.q6AZirRR1UsKKdkxvnmlmPDVQx09T-FckLl03aRh5Gw';

const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
const sb = createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});

const $ = (id) => document.getElementById(id);
const secEntrar = $('entrar');
const panel = $('panel');
const lista = $('lista');
const vacio = $('vacio');

let filtro = 'sin';

// ─────────────────────────── Entrar y salir ───────────────────────────

function decir(el, texto, clase) {
    el.textContent = texto;
    el.className = 'aviso' + (clase ? ' ' + clase : '');
}

$('formEntrar').addEventListener('submit', async (e) => {
    e.preventDefault();
    const boton = $('btnEntrar');
    boton.disabled = true;
    decir($('avisoEntrar'), 'Entrando…');

    const { error } = await sb.auth.signInWithPassword({
        email: $('email').value.trim(),
        password: $('clave').value
    });
    boton.disabled = false;

    if (error) {
        const m = String(error.message || '').toLowerCase();
        decir($('avisoEntrar'),
            m.includes('invalid login') ? 'Ese correo o esa contraseña no son correctos.'
            : m.includes('email not confirmed') ? 'Te falta confirmar el correo.'
            : 'No se ha podido entrar. Inténtalo de nuevo.', 'mal');
        return;
    }
    $('clave').value = '';
    decir($('avisoEntrar'), '');
    await mostrarPanel();
});

$('btnSalir').addEventListener('click', async () => {
    await sb.auth.signOut();
    panel.hidden = true;
    secEntrar.hidden = false;
    lista.innerHTML = '';
});

// ─────────────────────────── Los mensajes ───────────────────────────

async function mostrarPanel() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { secEntrar.hidden = false; panel.hidden = true; return; }

    secEntrar.hidden = true;
    panel.hidden = false;
    $('quien').textContent = session.user.email;
    await cargar();
}

async function cargar() {
    decir($('avisoPanel'), 'Cargando…');
    let consulta = sb.from('mensajes_web')
        .select('id, creado_en, nombre, email, asunto, mensaje, leido')
        .order('creado_en', { ascending: false })
        .limit(200);
    if (filtro === 'sin') consulta = consulta.eq('leido', false);

    const { data, error } = await consulta;
    if (error) {
        decir($('avisoPanel'), 'No se han podido cargar los mensajes.', 'mal');
        return;
    }
    decir($('avisoPanel'), '');
    pintar(data || []);
}

function pintar(mensajes) {
    lista.innerHTML = '';
    vacio.hidden = mensajes.length > 0;
    $('cuenta').textContent = mensajes.length === 1 ? '1 mensaje' : `${mensajes.length} mensajes`;

    for (const m of mensajes) {
        const art = document.createElement('article');
        art.className = 'msg' + (m.leido ? '' : ' nuevo');

        const cab = document.createElement('div');
        cab.className = 'msg-cab';
        if (!m.leido) {
            const p = document.createElement('span');
            p.className = 'punto';
            p.title = 'Sin leer';
            cab.appendChild(p);
        }
        const asunto = document.createElement('h2');
        asunto.className = 'msg-asunto';
        asunto.textContent = m.asunto;      // textContent: nada de HTML de fuera
        cab.appendChild(asunto);

        const fecha = document.createElement('span');
        fecha.className = 'msg-fecha';
        fecha.textContent = new Date(m.creado_en).toLocaleString('es-ES', {
            day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        cab.appendChild(fecha);
        art.appendChild(cab);

        const de = document.createElement('p');
        de.className = 'msg-de';
        de.append(document.createTextNode(m.nombre + ' · '));
        const correo = document.createElement('a');
        // El asunto se antepone con "Re:" para responder directamente
        correo.href = `mailto:${encodeURIComponent(m.email)}?subject=${encodeURIComponent('Re: ' + m.asunto)}`;
        correo.textContent = m.email;
        de.appendChild(correo);
        art.appendChild(de);

        const cuerpo = document.createElement('div');
        cuerpo.className = 'msg-cuerpo';
        cuerpo.textContent = m.mensaje;
        art.appendChild(cuerpo);

        if (!m.leido) {
            const pie = document.createElement('div');
            pie.className = 'msg-pie';
            const btn = document.createElement('button');
            btn.className = 'btn btn-ghost btn-mini';
            btn.type = 'button';
            btn.textContent = 'Marcar como leído';
            btn.addEventListener('click', async () => {
                btn.disabled = true;
                const { error } = await sb.from('mensajes_web').update({ leido: true }).eq('id', m.id);
                if (error) { btn.disabled = false; decir($('avisoPanel'), 'No se ha podido marcar.', 'mal'); return; }
                await cargar();
            });
            pie.appendChild(btn);
            art.appendChild(pie);
        }

        lista.appendChild(art);
    }
}

// ─────────────────────────── Filtros ───────────────────────────

document.querySelectorAll('[data-filtro]').forEach((b) => {
    b.addEventListener('click', () => {
        filtro = b.dataset.filtro;
        document.querySelectorAll('[data-filtro]').forEach((o) =>
            o.setAttribute('aria-pressed', String(o === b)));
        cargar();
    });
});
$('btnRecargar').addEventListener('click', cargar);

// Si ya había sesión de antes, directo al panel
mostrarPanel();
