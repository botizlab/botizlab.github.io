/**
 * El menú plegable de las barras que usan la hoja de GymSpeak (el juego y la
 * web del gimnasio).
 *
 * Antes esas dos barras simplemente escondían los enlaces por debajo de 900 px
 * y no ofrecían nada a cambio: en el móvil te quedabas sin navegación y sin
 * poder llegar a tu cuenta. Esto pone el botón y lo hace funcionar.
 *
 * El hub tiene su propio manejador en main.js porque su barra es distinta; lo
 * que se comparte de verdad —el botón de cuenta y el corredor— ya vive en sus
 * propios módulos.
 */

export function montarMenu() {
    const boton = document.getElementById('navToggle');
    const lista = document.getElementById('navLinks');
    if (!boton || !lista) return;

    const abrirCerrar = (abrir) => {
        lista.classList.toggle('abierto', abrir);
        boton.setAttribute('aria-expanded', String(abrir));
    };

    boton.addEventListener('click', (e) => {
        e.stopPropagation();
        abrirCerrar(!lista.classList.contains('abierto'));
    });

    // Al elegir destino se cierra solo: si no, el panel tapa aquello a lo que
    // acabas de saltar
    lista.querySelectorAll('a').forEach((a) =>
        a.addEventListener('click', () => abrirCerrar(false)));

    document.addEventListener('click', (e) => {
        if (!lista.contains(e.target) && e.target !== boton) abrirCerrar(false);
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') abrirCerrar(false);
    });
}
