/**
 * El muñeco que cruza la barra saltando los enlaces.
 *
 * Va en su propio módulo, con su SVG y sus estilos dentro, porque tiene que
 * aparecer en las barras de cuatro webs distintas. La lección ya la aprendimos
 * con el botón de cuenta: si el CSS se copia en cada sitio, tarde o temprano se
 * actualiza uno y se olvidan los otros.
 *
 *     import { montarCorredor } from 'https://botizlab.github.io/js/corredor.js';
 *     montarCorredor('.nav-inner');
 */

const ESTILOS = `
.corredor-pista { position: relative; }
.corredor {
  position: absolute; left: 0; bottom: 0; z-index: 0;
  pointer-events: none; will-change: transform;
}
`;

const DIBUJO = `
<svg class="corredor" width="14" height="23" viewBox="0 0 14 23" aria-hidden="true">
  <g stroke="currentColor" stroke-width="1.9" stroke-linecap="round" fill="none">
    <circle cx="7" cy="3.7" r="2.7" fill="currentColor" stroke="none" />
    <line x1="7" y1="6.6" x2="7" y2="13.4" />
    <line class="brazo-a" x1="7" y1="8.4" x2="11.2" y2="10.5" />
    <line class="brazo-b" x1="7" y1="8.4" x2="2.8" y2="10.5" />
    <line class="pierna-a" x1="7" y1="13.4" x2="10.5" y2="20" />
    <line class="pierna-b" x1="7" y1="13.4" x2="3.5" y2="20" />
  </g>
</svg>`;

const ALTURA = 15;
const VELOCIDAD = 1.35;

/**
 * @param {string|Element} pista   la barra por la que corre
 * @param {object} opciones
 *   - obstaculos: selector de lo que tiene que saltar (por defecto, los enlaces)
 */
export function montarCorredor(pista, opciones = {}) {
    const barra = typeof pista === 'string' ? document.querySelector(pista) : pista;
    if (!barra || barra.querySelector('.corredor')) return;

    if (!document.getElementById('estilos-corredor')) {
        const hoja = document.createElement('style');
        hoja.id = 'estilos-corredor';
        hoja.textContent = ESTILOS;
        document.head.append(hoja);
    }

    barra.classList.add('corredor-pista');
    barra.insertAdjacentHTML('afterbegin', DIBUJO);
    const runner = barra.querySelector('.corredor');

    const partes = {
        piernaA: runner.querySelector('.pierna-a'),
        piernaB: runner.querySelector('.pierna-b'),
        brazoA: runner.querySelector('.brazo-a'),
        brazoB: runner.querySelector('.brazo-b')
    };

    // Quien prefiere no ver movimiento se queda con el muñeco quieto
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        runner.style.transform = 'translateX(90px)';
        return;
    }

    const selector = opciones.obstaculos || 'a, button';
    const obstaculos = () =>
        // Solo lo que se ve: con el menú plegado no hay nada que saltar
        [...barra.querySelectorAll(selector)]
            .filter((el) => el.offsetParent !== null && el.offsetWidth > 0)
            .map((el) => {
                // Se mide respecto a la barra, no al padre directo: los enlaces
                // suelen ir dentro de un <li> o de un <div>, y offsetLeft es
                // relativo a ese, no a la pista
                const r = el.getBoundingClientRect();
                const b = barra.getBoundingClientRect();
                return { centro: r.left - b.left + r.width / 2, radio: 20 };
            });

    let x = -26;

    const paso = (t) => {
        const ancho = barra.clientWidth;
        x += VELOCIDAD;
        if (x > ancho + 20) x = -26;

        // Campana de coseno: el punto más alto cae JUSTO encima del enlace. Con
        // un seno el máximo queda en los lados y el muñeco baja sobre él en vez
        // de saltarlo. El radio es menor que media distancia entre enlaces, o
        // los arcos se solapan y sale un temblor continuo en vez de saltos.
        let salto = 0;
        for (const o of obstaculos()) {
            const d = Math.abs(x - o.centro);
            if (d < o.radio) {
                salto = Math.max(salto, ((1 + Math.cos((Math.PI * d) / o.radio)) / 2) * ALTURA);
            }
        }

        runner.style.transform = `translate(${x}px, ${-salto}px)`;

        // En el aire las piernas se quedan quietas, como en el juego
        const fase = salto > 1 ? 0.55 : Math.sin(t / 82) * 0.85;
        partes.piernaA.setAttribute('transform', `rotate(${fase * 24} 7 13.4)`);
        partes.piernaB.setAttribute('transform', `rotate(${-fase * 24} 7 13.4)`);
        partes.brazoA.setAttribute('transform', `rotate(${-fase * 18} 7 8.4)`);
        partes.brazoB.setAttribute('transform', `rotate(${fase * 18} 7 8.4)`);

        requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
}
