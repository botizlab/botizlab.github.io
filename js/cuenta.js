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
 * Pinta el botón de cuenta dentro del elemento que se le pase.
 *
 * Se llama desde las tres webs, y cada una le da el hueco que quiera. Si hay
 * sesión muestra el emoji y el nombre y lleva al perfil; si no, abre el panel
 * de entrar.
 */
export async function montarBoton(hueco, opciones = {}) {
    if (!hueco) return;
    const rutaPerfil = opciones.rutaPerfil || 'https://botizlab.github.io/cuenta/';

    const p = await perfil();
    hueco.textContent = '';

    if (p) {
        const a = document.createElement('a');
        a.className = 'cuenta-btn';
        a.href = rutaPerfil;
        const emoji = document.createElement('span');
        emoji.className = 'cuenta-emoji';
        emoji.textContent = p.avatar_emoji || '💪';
        const nombre = document.createElement('span');
        nombre.className = 'cuenta-nombre';
        nombre.textContent = comoTeLlamas(p);
        a.append(emoji, nombre);
        hueco.append(a);
        return;
    }

    const b = document.createElement('a');
    b.className = 'cuenta-btn cuenta-entrar';
    b.href = rutaPerfil;
    b.textContent = 'Entrar';
    hueco.append(b);
}
