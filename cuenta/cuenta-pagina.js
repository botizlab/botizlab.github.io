/**
 * La página de cuenta: entrar, crear cuenta y editar el perfil.
 *
 * Toda la lógica de sesión vive en /js/cuenta.js, que comparten las tres webs.
 * Aquí solo está lo que se ve.
 */

import {
    sesion, entrar, registrar, salir, recuperar,
    perfil, guardarPerfil, comoTeLlamas
} from '../js/cuenta.js?v=7';

const $ = (id) => document.getElementById(id);

let modo = 'entrar';

const decir = (el, texto, clase) => {
    el.textContent = texto;
    el.className = 'aviso' + (clase ? ' ' + clase : '');
};

// ═══════════════════ Validación campo a campo ═══════════════════
// Las reglas del usuario y la contraseña son las que de verdad aplica
// Supabase: mínimo 6 caracteres, y el usuario es UNIQUE en la tabla.

const CORREO = /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/;
const USUARIO = /^[a-z0-9_.]{3,20}$/;

const REGLAS = {
    nombre: (v) => (v && v.length > 40 ? 'Máximo 40 caracteres.' : null),
    usuario: (v) => (!v ? null
        : !USUARIO.test(v.toLowerCase()) ? 'Entre 3 y 20 caracteres: letras, números, punto o guion bajo.'
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

document.querySelectorAll('[data-modo]').forEach((b) => {
    b.addEventListener('click', () => {
        modo = b.dataset.modo;
        document.querySelectorAll('[data-modo]').forEach((o) =>
            o.setAttribute('aria-selected', String(o === b)));
        const registro = modo === 'registro';
        document.querySelector('.solo-registro').hidden = !registro;
        $('btnAcceso').textContent = registro ? 'Crear cuenta' : 'Entrar';
        $('btnOlvide').hidden = registro;
        $('explica').textContent = registro
            ? 'Con esta cuenta entras también en la app del móvil y en el juego. Es una sola.'
            : 'Es la misma cuenta de la app de GymSpeak. Si ya la tienes, entra con ella.';
        formAcceso.elements.clave.setAttribute('autocomplete', registro ? 'new-password' : 'current-password');
        decir($('avisoAcceso'), '');
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
}

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
            username: ($('pUsuario').value.trim() || '').toLowerCase() || null
        });
        decir($('avisoPerfil'), 'Guardado.', 'ok');
        await pintarPerfil(await perfil());
    } catch (err) {
        decir($('avisoPerfil'), err.message, 'mal');
    } finally {
        boton.disabled = false;
    }
});

$('btnSalir').addEventListener('click', async () => {
    await salir();
    await pintarSegunSesion();
});

// ═══════════════════ Qué se enseña ═══════════════════

async function pintarSegunSesion() {
    $('cargando').hidden = true;
    const s = await sesion();
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
