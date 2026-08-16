/**
 * Duelos del Runner: uno contra uno por internet.
 *
 * La idea que lo sostiene todo: NO se sincroniza la partida. Los dos
 * navegadores generan la misma pista a partir de una semilla compartida, así
 * que no hay que mandar obstáculos, ni posiciones, ni corregir desfases —que
 * es donde se complica el multijugador de verdad—. Por la red solo viaja
 * "voy por X segundos y sigo vivo", y eso ni toca la base de datos: va por un
 * canal efímero de Realtime.
 *
 * El emparejamiento sí es cosa del servidor, porque hacerlo desde el cliente
 * es una carrera: dos personas ven al mismo rival libre y las dos creen
 * haberlo cogido. Eso lo resuelve una función de Postgres.
 *
 * Todo cuelga de la sesión: hay que estar registrado, con la misma cuenta de
 * la app.
 */

// La clave anónima es pública POR DISEÑO: ya viaja dentro del APK que está en
// Google Play. Lo que protege los datos no es esconderla, son las políticas
// RLS de Supabase, que deciden qué puede leer y escribir cada sesión.
const SUPABASE_URL = 'https://datuqilcshjvapujdool.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRhdHVxaWxjc2hqdmFwdWpkb29sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwNDgxMzIsImV4cCI6MjA5NDYyNDEzMn0.q6AZirRR1UsKKdkxvnmlmPDVQx09T-FckLl03aRh5Gw';

let cliente = null;

/** Carga el SDK solo cuando de verdad se va a jugar un duelo. */
async function conectar() {
    if (cliente) return cliente;
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    cliente = createClient(SUPABASE_URL, SUPABASE_ANON, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
    return cliente;
}

// ================= Sesión =================

export async function sesionActual() {
    const sb = await conectar();
    const { data } = await sb.auth.getSession();
    return data.session || null;
}

export async function iniciarSesion(email, password) {
    const sb = await conectar();
    const { data, error } = await sb.auth.signInWithPassword({
        email: String(email || '').trim(),
        password: String(password || '')
    });
    if (error) throw new Error(traducirError(error.message));
    return data.session;
}

export async function cerrarSesion() {
    const sb = await conectar();
    await sb.auth.signOut();
}

/** Mensajes de Supabase en cristiano. */
function traducirError(msg) {
    const m = String(msg || '').toLowerCase();
    // Si las funciones aún no están creadas en la base de datos, mejor decirlo
    // claro que soltar un error de Postgres que no le sirve a nadie
    if (m.includes('schema cache') || m.includes('does not exist') || m.includes('42883')) {
        return 'El uno contra uno todavía no está activo. Vuelve pronto.';
    }
    if (m.includes('invalid login')) return 'Ese correo o esa contraseña no son correctos.';
    if (m.includes('email not confirmed')) return 'Te falta confirmar el correo. Mira tu bandeja.';
    if (m.includes('network')) return 'No hay conexión con el servidor.';
    if (m.includes('rate limit') || m.includes('too many')) return 'Demasiados intentos. Espera un poco.';
    return 'No se ha podido entrar. Inténtalo de nuevo.';
}

// ================= Emparejamiento =================

let buscando = false;

/**
 * Busca rival. Devuelve { duelo, soyA } cuando encuentra a alguien.
 *
 * Quien llega primero se queda esperando en la cola y es el SEGUNDO quien
 * crea el duelo, así que el primero tiene que ir preguntando si ya le han
 * emparejado. Con la gente que va a haber, preguntar cada segundo y medio
 * sobra: montar suscripciones en tiempo real para esto sería complicarlo por
 * gusto.
 */
export async function buscarRival(onEstado) {
    const sb = await conectar();
    const sesion = await sesionActual();
    if (!sesion) throw new Error('Hay que iniciar sesión');

    buscando = true;
    onEstado?.('Buscando rival…');

    const { data, error } = await sb.rpc('runner_buscar_rival');
    if (error) throw new Error(traducirError(error.message));
    if (data) return { duelo: data, soyA: data.jugador_a === sesion.user.id };

    // En cola: a preguntar cada poco hasta que alguien entre
    const hasta = Date.now() + 110000;   // el servidor limpia a los 2 minutos
    while (buscando && Date.now() < hasta) {
        await espera(1500);
        if (!buscando) break;
        const { data: mio } = await sb.rpc('runner_mi_duelo');
        if (mio) return { duelo: mio, soyA: mio.jugador_a === sesion.user.id };
        onEstado?.('Esperando a que entre alguien…');
    }

    await cancelarBusqueda();
    return null;
}

export async function cancelarBusqueda() {
    buscando = false;
    try {
        const sb = await conectar();
        await sb.rpc('runner_salir_cola');
    } catch { /* si falla, el servidor lo limpia solo en dos minutos */ }
}

// ================= El duelo en marcha =================

/**
 * Abre el canal del duelo. Lo que se manda son mensajes efímeros: no se
 * guardan en ningún sitio ni cuestan escrituras.
 *
 * Devuelve { publicar, cerrar }.
 */
export async function abrirCanal(dueloId, onRival) {
    const sb = await conectar();
    const canal = sb.channel(`duelo:${dueloId}`, { config: { broadcast: { self: false } } });

    canal.on('broadcast', { event: 'estado' }, ({ payload }) => onRival?.(payload));
    await canal.subscribe();

    let ultimoEnvio = 0;
    return {
        /** Mensajes de sala (listo, me voy): sin límite de ritmo, son contados. */
        avisar(payload) {
            canal.send({ type: 'broadcast', event: 'estado', payload });
        },
        /** Se llama en cada fotograma; solo sale por la red cada 250 ms. */
        publicar(segundos, vivo) {
            const ahora = Date.now();
            if (ahora - ultimoEnvio < 250) return;
            ultimoEnvio = ahora;
            canal.send({
                type: 'broadcast',
                event: 'estado',
                payload: { t: Math.round(segundos * 10) / 10, vivo: !!vivo }
            });
        },
        async cerrar() {
            try { await sb.removeChannel(canal); } catch { /* da igual */ }
        }
    };
}

export async function guardarTiempo(dueloId, segundos) {
    const sb = await conectar();
    const { data, error } = await sb.rpc('runner_guardar_tiempo', {
        p_duelo: dueloId,
        p_segundos: Math.round(segundos * 100) / 100
    });
    if (error) throw new Error(traducirError(error.message));
    return data;
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
