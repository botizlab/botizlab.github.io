/**
 * La página de cuenta: entrar, crear cuenta y editar el perfil.
 *
 * Toda la lógica de sesión vive en /js/cuenta.js, que comparten las tres webs.
 * Aquí solo está lo que se ve.
 */

import {
    sesion, entrar, registrar, salir, recuperar,
    perfil, guardarPerfil, comoTeLlamas, confirmar
} from '../js/cuenta.js?v=15';

const $ = (id) => document.getElementById(id);
const EMOJIS = ['💪', '🏋️', '🔥', '⚡', '🏃', '🥇', '🧠', '🦍', '🐺', '🚀', '🎯', '🥋'];
let emojiElegido = '💪';

let modo = 'entrar';

const decir = (el, texto, clase) => {
    el.textContent = texto;
    el.className = 'aviso' + (clase ? ' ' + clase : '');
};

// ═══════════════════ Validación campo a campo ═══════════════════
// Las reglas del usuario y la contraseña son las que de verdad aplica
// Supabase: mínimo 6 caracteres, y el usuario es UNIQUE en la tabla.

const CORREO = /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/;
const USUARIO = /^[a-z0-9_.]{3,24}$/;

const REGLAS = {
    nombre: (v) => (v && v.length > 40 ? 'Máximo 40 caracteres.' : null),
    usuario: (v) => (!v ? null
        : !USUARIO.test(v.toLowerCase()) ? 'Entre 3 y 24 caracteres: letras, números, punto o guion bajo.'
        : null),
    email: (v) => (!v ? 'Hace falta tu correo.'
        : !CORREO.test(v) ? 'Eso no parece un correo.'
        : null),
    clave: (v) => (!v ? 'Hace falta la contraseña.'
        : modo === 'registro' && v.length < 6 ? 'Al menos 6 caracteres.'
        : null)
};

/** Revisa un campo y lo marca. Devuelve true si está bien. */
function revisar(el, idHueco, regla) {
    const fallo = regla((el.value || '').trim());
    $(idHueco).textContent = fallo || '';
    el.classList.toggle('malo', !!fallo);
    el.setAttribute('aria-invalid', fallo ? 'true' : 'false');
    return !fallo;
}

// ═══════════════════ Entrar / registrarse ═══════════════════

const formAcceso = $('formAcceso');

/** Deja la pantalla en el modo actual. Un solo sitio decide qué se ve. */
function aplicarModo() {
    const registro = modo === 'registro';
    document.querySelectorAll('.solo-registro').forEach((el) => { el.hidden = !registro; });
    $('btnAcceso').textContent = registro ? 'Crear cuenta' : 'Entrar';
    $('btnOlvide').hidden = registro;
    $('explica').textContent = registro
        ? 'Crea una cuenta para BotizLab.'
        : 'Si ya tienes cuenta de BotizLab, inicia sesión.';
    $('cambiarTexto').textContent = registro ? '¿Ya tienes cuenta?' : '¿No tienes cuenta?';
    $('btnCambiar').textContent = registro ? 'Iniciar sesión' : 'Crear una';
    formAcceso.elements.clave.setAttribute('autocomplete', registro ? 'new-password' : 'current-password');
    document.querySelectorAll('[data-modo]').forEach((o) =>
        o.setAttribute('aria-selected', String(o.dataset.modo === modo)));
    decir($('avisoAcceso'), '');
}

/** El enlace de abajo hace lo mismo que las pestañas. */
$('btnCambiar').addEventListener('click', () => {
    modo = modo === 'registro' ? 'entrar' : 'registro';
    aplicarModo();
});

document.querySelectorAll('[data-modo]').forEach((b) => {
    b.addEventListener('click', () => {
        modo = b.dataset.modo;
        document.querySelectorAll('[data-modo]').forEach((o) =>
            o.setAttribute('aria-selected', String(o === b)));
        aplicarModo();
    });
});

for (const campo of ['nombre', 'usuario', 'email', 'clave']) {
    const el = formAcceso.elements[campo];
    if (!el) continue;
    el.addEventListener('blur', () => revisar(el, 'e-' + campo, REGLAS[campo]));
    el.addEventListener('input', () => {
        if (el.classList.contains('malo')) revisar(el, 'e-' + campo, REGLAS[campo]);
    });
}

formAcceso.addEventListener('submit', async (e) => {
    e.preventDefault();
    const aCorregir = (modo === 'registro' ? ['nombre', 'usuario', 'email', 'clave'] : ['email', 'clave'])
        .filter((c) => !revisar(formAcceso.elements[c], 'e-' + c, REGLAS[c]));
    if (aCorregir.length) {
        decir($('avisoAcceso'), 'Repasa lo marcado.', 'mal');
        formAcceso.elements[aCorregir[0]].focus();
        return;
    }

    // Sin aceptar los términos no se crea la cuenta. Se comprueba aquí y no
    // con `required` en el HTML porque el formulario lleva `novalidate`.
    if (modo === 'registro' && !formAcceso.elements.acepto.checked) {
        $('e-acepto').textContent = 'Tienes que aceptar los términos para crear la cuenta.';
        document.querySelector('.acepto').classList.add('malo');
        decir($('avisoAcceso'), 'Falta aceptar los términos.', 'mal');
        formAcceso.elements.acepto.focus();
        return;
    }

    const boton = $('btnAcceso');
    boton.disabled = true;
    decir($('avisoAcceso'), modo === 'registro' ? 'Creando la cuenta…' : 'Entrando…');

    try {
        const datos = formAcceso.elements;
        if (modo === 'registro') {
            const r = await registrar(
                datos.email.value, datos.clave.value,
                datos.nombre.value.trim() || null,
                (datos.usuario.value.trim() || '').toLowerCase() || null
            );
            if (r.hayQueConfirmar) {
                decir($('avisoAcceso'),
                    'Cuenta creada. Te he mandado un correo para confirmarla: míralo, y si no aparece, revisa el spam.', 'ok');
                boton.disabled = false;
                return;
            }
        } else {
            await entrar(datos.email.value, datos.clave.value);
        }
        datos.clave.value = '';
        await pintarSegunSesion();
    } catch (err) {
        decir($('avisoAcceso'), err.message, 'mal');
    } finally {
        boton.disabled = false;
    }
});

formAcceso.elements.acepto?.addEventListener('change', (ev) => {
    if (!ev.target.checked) return;
    $('e-acepto').textContent = '';
    document.querySelector('.acepto').classList.remove('malo');
});

$('btnOlvide').addEventListener('click', async () => {
    const email = formAcceso.elements.email.value.trim();
    if (!revisar(formAcceso.elements.email, 'e-email', REGLAS.email)) {
        decir($('avisoAcceso'), 'Escribe tu correo arriba y vuelve a darle.', 'mal');
        formAcceso.elements.email.focus();
        return;
    }
    try {
        await recuperar(email);
        decir($('avisoAcceso'), 'Te he mandado un correo para cambiar la contraseña. Mira también el spam.', 'ok');
    } catch (err) {
        decir($('avisoAcceso'), err.message, 'mal');
    }
});

// ═══════════════════ El perfil ═══════════════════

async function pintarPerfil(p) {
    $('nombreGrande').textContent = comoTeLlamas(p);
    $('usuarioChico').textContent = p.username ? '@' + p.username : 'Sin nombre de usuario';
    $('correo').textContent = p.email || '';
    $('emoji').textContent = p.avatar_emoji || '💪';
    $('desde').textContent = p.created_at
        ? new Date(p.created_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })
        : '—';
    $('pNombre').value = p.display_name || '';
    $('pUsuario').value = p.username || '';
    $('pBio').value = p.bio || '';
    $('pUnidad').value = p.weight_unit === 'lb' ? 'lb' : 'kg';
    $('pCalendario').checked = !!p.public_calendar;
    emojiElegido = p.avatar_emoji || '💪';
    pintarEmojis();
    contarBio();
}

function pintarEmojis() {
    const caja = $('emojis');
    caja.textContent = '';
    for (const e of EMOJIS) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'emoji-op';
        b.textContent = e;
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(e === emojiElegido));
        b.addEventListener('click', () => {
            emojiElegido = e;
            $('emoji').textContent = e;
            caja.querySelectorAll('.emoji-op').forEach((o) =>
                o.setAttribute('aria-checked', String(o.textContent === e)));
        });
        caja.append(b);
    }
}

function contarBio() {
    const n = $('pBio').value.length;
    $('contadorBio').textContent = n ? `${n}/150` : '';
}
$('pBio').addEventListener('input', contarBio);

// Los ajustes van en su propio formulario: son cosas distintas del perfil y
// mezclarlas haría que guardar el nombre tocara también tu calendario
$('formAjustes').addEventListener('submit', async (e) => {
    e.preventDefault();
    const boton = $('btnAjustes');
    boton.disabled = true;
    decir($('avisoAjustes'), 'Guardando…');
    try {
        await guardarPerfil({
            weight_unit: $('pUnidad').value,
            public_calendar: $('pCalendario').checked
        });
        decir($('avisoAjustes'), 'Guardado.', 'ok');
    } catch (err) {
        decir($('avisoAjustes'), err.message, 'mal');
    } finally {
        boton.disabled = false;
    }
});

$('formPerfil').addEventListener('submit', async (e) => {
    e.preventDefault();
    const okNombre = revisar($('pNombre'), 'e-pnombre', REGLAS.nombre);
    const okUsuario = revisar($('pUsuario'), 'e-pusuario', REGLAS.usuario);
    if (!okNombre || !okUsuario) { decir($('avisoPerfil'), 'Repasa lo marcado.', 'mal'); return; }

    const boton = $('btnGuardar');
    boton.disabled = true;
    decir($('avisoPerfil'), 'Guardando…');
    try {
        await guardarPerfil({
            display_name: $('pNombre').value.trim() || null,
            // Se quita la arroba por si la escriben: en la tabla va sin ella
            username: ($('pUsuario').value.trim().replace(/^@/, '') || '').toLowerCase() || null,
            bio: $('pBio').value.trim() || null,
            avatar_emoji: emojiElegido
        });
        decir($('avisoPerfil'), 'Guardado.', 'ok');
        await pintarPerfil(await perfil());
    } catch (err) {
        decir($('avisoPerfil'), err.message, 'mal');
    } finally {
        boton.disabled = false;
    }
});

// El mismo cuadro que el desplegable: se pregunta igual en toda la web
$('btnSalir').addEventListener('click', async () => {
    if (!(await confirmar('¿Seguro que quieres cerrar sesión?'))) return;
    const b = $('btnSalir');
    b.disabled = true;
    b.textContent = 'Saliendo…';
    await salir();
    b.disabled = false;
    b.textContent = 'Cerrar sesión';
    await pintarSegunSesion();
});

// ═══════════════════ Qué se enseña ═══════════════════

async function pintarSegunSesion() {
    $('cargando').hidden = true;
    const s = await sesion();
    // La tarjeta de acceso se centra en vertical; el perfil no, que es largo
    document.body.classList.toggle('centrado', !s);
    if (!s) {
        $('acceso').hidden = false;
        $('perfil').hidden = true;
        return;
    }
    $('acceso').hidden = true;
    $('perfil').hidden = false;
    await pintarPerfil(await perfil());
}

pintarSegunSesion();
