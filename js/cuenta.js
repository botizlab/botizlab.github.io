/**
 * La cuenta, compartida por todas las webs.
 *
 * Las tres páginas —esta, /juego/ y /gymspeak-web/— viven en el MISMO origen
 * (botizlab.github.io), así que comparten localStorage. Como Supabase guarda
 * ahí la sesión, con entrar una vez ya estás dentro en todas: no hay nada que
 * sincronizar, ni cookies, ni tokens viajando de un lado a otro.
 *
 * Y es la misma cuenta de la app del móvil, porque es el mismo proyecto de
 * Supabase y la misma tabla `profiles`. Al registrarse aquí, el disparador
 * `handle_new_user` crea el perfil igual que si te hubieras registrado en la
 * app.
 *
 * La clave anónima es pública por diseño: ya viaja dentro del APK de Google
 * Play. Lo que protege los datos son las políticas RLS, no esconderla.
 */

const SUPABASE_URL = 'https://datuqilcshjvapujdool.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRhdHVxaWxjc2hqdmFwdWpkb29sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwNDgxMzIsImV4cCI6MjA5NDYyNDEzMn0.q6AZirRR1UsKKdkxvnmlmPDVQx09T-FckLl03aRh5Gw';

let cliente = null;

/** El SDK solo se descarga cuando de verdad hace falta. */
async function conectar() {
    if (cliente) return cliente;
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    cliente = createClient(SUPABASE_URL, SUPABASE_ANON, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
    return cliente;
}

// ═══════════════════════════ Sesión ═══════════════════════════

export async function sesion() {
    const sb = await conectar();
    const { data } = await sb.auth.getSession();
    return data.session || null;
}

export async function entrar(email, clave) {
    const sb = await conectar();
    const { data, error } = await sb.auth.signInWithPassword({
        email: String(email || '').trim().toLowerCase(),
        password: String(clave || '')
    });
    if (error) throw new Error(traducir(error.message));
    return data.session;
}

/**
 * Registro. El nombre y el usuario van en los metadatos porque el disparador
 * de la base de datos los saca de ahí para crear el perfil.
 */
export async function registrar(email, clave, nombre, usuario) {
    const sb = await conectar();
    const { data, error } = await sb.auth.signUp({
        email: String(email || '').trim().toLowerCase(),
        password: String(clave || ''),
        options: { data: { display_name: nombre || null, username: usuario || null } }
    });
    if (error) throw new Error(traducir(error.message));
    // Con la verificación por correo activada no hay sesión hasta confirmar
    return { sesion: data.session, hayQueConfirmar: !data.session };
}

export async function salir() {
    const sb = await conectar();
    await sb.auth.signOut();
}

export async function recuperar(email) {
    const sb = await conectar();
    const { error } = await sb.auth.resetPasswordForEmail(
        String(email || '').trim().toLowerCase(),
        { redirectTo: 'https://botizlab.github.io/gymspeak-web/reset.html' }
    );
    if (error) throw new Error(traducir(error.message));
}

// ═══════════════════════════ Perfil ═══════════════════════════

export async function perfil() {
    const s = await sesion();
    if (!s) return null;
    const sb = await conectar();
    const { data } = await sb
        .from('profiles')
        .select('id, display_name, username, avatar_emoji, language, created_at')
        .eq('id', s.user.id)
        .maybeSingle();
    return data ? { ...data, email: s.user.email } : { id: s.user.id, email: s.user.email };
}

export async function guardarPerfil(cambios) {
    const s = await sesion();
    if (!s) throw new Error('No hay sesión');
    const sb = await conectar();
    const { error } = await sb.from('profiles').update(cambios).eq('id', s.user.id);
    if (error) {
        // El usuario es único en la tabla: el choque hay que contarlo bien
        if (/duplicate key|unique/i.test(error.message)) throw new Error('Ese nombre de usuario ya está cogido.');
        throw new Error('No se han podido guardar los cambios.');
    }
}

/** Cómo llamarte en la interfaz, con lo que haya. */
export function comoTeLlamas(p) {
    if (!p) return '';
    return p.display_name || (p.username ? '@' + p.username : (p.email || '').split('@')[0]);
}

// ═══════════════════════════ Mensajes de Supabase, en cristiano ═══════════════

function traducir(msg) {
    const m = String(msg || '').toLowerCase();
    if (m.includes('invalid login')) return 'Ese correo o esa contraseña no son correctos.';
    if (m.includes('email not confirmed')) return 'Te falta confirmar el correo. Mira tu bandeja de entrada, y la carpeta de spam.';
    if (m.includes('already registered') || m.includes('already been registered')) return 'Ya hay una cuenta con ese correo. Inicia sesión.';
    if (m.includes('password') && m.includes('at least')) return 'La contraseña necesita al menos 6 caracteres.';
    if (m.includes('weak password')) return 'Esa contraseña es demasiado fácil. Ponle algo más largo.';
    if (m.includes('rate limit') || m.includes('too many') || m.includes('for security purposes')) {
        return 'Demasiados intentos seguidos. Espera un minuto.';
    }
    if (m.includes('network') || m.includes('fetch')) return 'No hay conexión con el servidor.';
    return 'No se ha podido completar. Inténtalo de nuevo.';
}

// ═══════════════════════════ El botón de la barra ═══════════════════════════

/**
 * Los estilos van AQUÍ, con el componente, y no copiados en el CSS de cada web.
 *
 * Se intentó al revés y salió mal: al añadir el desplegable actualicé la hoja
 * del hub y me dejé las otras dos, así que en la web del gimnasio y en el juego
 * el menú aparecía suelto y sin pintar. Con las reglas dentro del módulo, quien
 * lo usa lo recibe entero.
 *
 * Los colores salen de variables con alternativa, porque cada web tiene las
 * suyas con nombres distintos.
 */
const ESTILOS = `
.hueco-cuenta { position: relative; display: inline-flex; align-items: center; }
.cuenta-btn {
  display: inline-flex; align-items: center; gap: 7px;
  font: inherit; font-size: 13px; font-weight: 700; white-space: nowrap;
  text-decoration: none; cursor: pointer;
  color: var(--text, var(--text-main, #f4f4f6));
  background: none;
  border: 1px solid var(--border, var(--glass-border, rgba(255,255,255,.1)));
  border-radius: 999px; padding: 5px 12px 5px 6px;
  transition: border-color .18s;
}
.cuenta-btn:hover, .cuenta-btn[aria-expanded="true"] {
  border-color: var(--accent, var(--accent-green, #5ad67d));
}
.cuenta-entrar { padding: 6px 15px; color: var(--muted, var(--text-muted, #9a9aa3)); }
.cuenta-entrar:hover { color: var(--text, var(--text-main, #f4f4f6)); }
.cuenta-emoji {
  width: 22px; height: 22px; display: grid; place-items: center; font-size: 13px;
  background: rgba(255,255,255,.07); border-radius: 50%; flex: 0 0 auto;
}
.cuenta-nombre { max-width: 12ch; overflow: hidden; text-overflow: ellipsis; }
.cuenta-flecha { font-size: 9px; opacity: .6; }
.cuenta-menu {
  position: absolute; top: calc(100% + 8px); right: 0; z-index: 200;
  min-width: 178px; padding: 5px;
  background: var(--surface, #16161a);
  border: 1px solid var(--border, var(--glass-border, rgba(255,255,255,.1)));
  border-radius: 11px; box-shadow: 0 14px 34px rgba(0,0,0,.55);
  display: flex; flex-direction: column;
}
.cuenta-menu[hidden] { display: none; }
.cuenta-menu a, .cuenta-menu button {
  font: inherit; font-size: 13px; font-weight: 600; text-align: left; cursor: pointer;
  color: var(--muted, var(--text-muted, #9a9aa3));
  background: none; border: 0; border-radius: 7px; text-decoration: none;
  padding: 9px 11px; white-space: nowrap;
  transition: background .15s, color .15s;
}
.cuenta-menu a:hover, .cuenta-menu button:hover {
  background: rgba(255,255,255,.06);
  color: var(--text, var(--text-main, #f4f4f6));
}
.cuenta-menu .cuenta-salir:hover { color: #e57b63; }
.cuenta-menu .cuenta-salir.confirmando {
  color: #e57b63; background: rgba(229,123,99,.12); font-weight: 700;
}
.cuenta-menu .cuenta-salir:disabled { opacity: .6; cursor: default; }
`;

function ponerEstilos() {
    if (document.getElementById('estilos-cuenta')) return;
    const hoja = document.createElement('style');
    hoja.id = 'estilos-cuenta';
    hoja.textContent = ESTILOS;
    document.head.append(hoja);
}

/**
 * Pinta el botón de cuenta dentro del elemento que se le pase.
 *
 * Se llama desde las tres webs, y cada una le da el hueco que quiera. Si hay
 * sesión muestra el emoji y el nombre y lleva al perfil; si no, abre el panel
 * de entrar.
 */
export async function montarBoton(hueco, opciones = {}) {
    if (!hueco) return;
    const rutaPerfil = opciones.rutaPerfil || 'https://botizlab.github.io/cuenta/';

    ponerEstilos();

    const p = await perfil();
    hueco.textContent = '';
    hueco.classList.add('hueco-cuenta');

    // Sin sesión: un enlace y ya está, nada que desplegar
    if (!p) {
        const b = document.createElement('a');
        b.className = 'cuenta-btn cuenta-entrar';
        b.href = rutaPerfil;
        b.textContent = 'Entrar';
        hueco.append(b);
        return;
    }

    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'cuenta-btn';
    boton.setAttribute('aria-expanded', 'false');
    boton.setAttribute('aria-haspopup', 'menu');

    const emoji = document.createElement('span');
    emoji.className = 'cuenta-emoji';
    emoji.textContent = p.avatar_emoji || '💪';
    const nombre = document.createElement('span');
    nombre.className = 'cuenta-nombre';
    nombre.textContent = comoTeLlamas(p);
    const flecha = document.createElement('span');
    flecha.className = 'cuenta-flecha';
    flecha.setAttribute('aria-hidden', 'true');
    flecha.textContent = '▾';
    boton.append(emoji, nombre, flecha);

    const menu = document.createElement('div');
    menu.className = 'cuenta-menu';
    menu.setAttribute('role', 'menu');
    menu.hidden = true;

    const irPerfil = document.createElement('a');
    irPerfil.href = rutaPerfil;
    irPerfil.setAttribute('role', 'menuitem');
    irPerfil.textContent = 'Mi cuenta';

    // El panel: la app en el navegador, con la misma cuenta
    const irPanel = document.createElement('a');
    irPanel.href = 'https://botizlab.github.io/gymspeak-panel/';
    irPanel.setAttribute('role', 'menuitem');
    irPanel.textContent = 'GymSpeak web';

    const cerrar = document.createElement('button');
    cerrar.type = 'button';
    cerrar.setAttribute('role', 'menuitem');
    cerrar.className = 'cuenta-salir';
    cerrar.textContent = 'Cerrar sesión';
    // Dos pasos, en el mismo botón: el primer clic pregunta y el segundo hace.
    // Sin diálogo aparte, que para esto sobra, pero sin salirse de un roce.
    let confirmando = false;
    let vuelta = null;
    cerrar.addEventListener('click', async () => {
        if (!confirmando) {
            confirmando = true;
            cerrar.textContent = '¿Seguro? Pulsa otra vez';
            cerrar.classList.add('confirmando');
            // Si se lo piensa y no vuelve, el botón se rinde solo
            vuelta = setTimeout(() => {
                confirmando = false;
                cerrar.textContent = 'Cerrar sesión';
                cerrar.classList.remove('confirmando');
            }, 4000);
            return;
        }
        clearTimeout(vuelta);
        cerrar.disabled = true;
        cerrar.textContent = 'Saliendo…';
        await salir();
        location.reload();
    });

    menu.append(irPerfil, irPanel, cerrar);
    hueco.append(boton, menu);

    const abrirCerrar = (abrir) => {
        menu.hidden = !abrir;
        boton.setAttribute('aria-expanded', String(abrir));
    };

    boton.addEventListener('click', (e) => {
        e.stopPropagation();
        abrirCerrar(menu.hidden);
    });
    // Un clic fuera o Escape lo cierran: si no, se queda abierto para siempre
    document.addEventListener('click', () => abrirCerrar(false));
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !menu.hidden) { abrirCerrar(false); boton.focus(); }
    });
    menu.addEventListener('click', (e) => e.stopPropagation());
}
