// Carlos Botiz — interacciones mínimas

// Año del pie
const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = new Date().getFullYear();

// Menú en pantallas estrechas
const toggle = document.getElementById('navToggle');
const links = document.getElementById('navLinks');
if (toggle && links) {
  toggle.addEventListener('click', () => {
    const abierto = links.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(abierto));
  });
  links.querySelectorAll('a').forEach((a) =>
    a.addEventListener('click', () => {
      links.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    })
  );
}

// Aparición al bajar
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        e.target.classList.add('in');
        observer.unobserve(e.target);
      }
    });
  },
  { threshold: 0.12 }
);
document.querySelectorAll('.reveal').forEach((el) => observer.observe(el));

/**
 * El muñeco cruza la barra y salta los enlaces.
 *
 * Dos detalles que se ven raros si no se cuidan: el arco del salto tiene que
 * estar en su punto más alto JUSTO encima del enlace (de ahí la campana de
 * coseno, y no un seno, que tiene el máximo en los lados), y el radio de
 * influencia tiene que ser menor que media distancia entre enlaces, o los
 * arcos se solapan y en vez de saltos sale un temblor continuo.
 */
(() => {
  const barra = document.querySelector('.nav-inner');
  const runner = document.querySelector('.runner');
  if (!barra || !runner) return;

  const partes = {
    piernaA: runner.querySelector('.leg-a'),
    piernaB: runner.querySelector('.leg-b'),
    brazoA: runner.querySelector('.arm-a'),
    brazoB: runner.querySelector('.arm-b')
  };

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    runner.style.transform = 'translateX(96px)';
    return;
  }

  const ALTURA = 15;
  let x = -26;

  const obstaculos = () =>
    // Solo los que se ven: con el menú plegado no hay nada que saltar
    [...document.querySelectorAll('.nav-links a'), document.querySelector('.mono')]
      .filter((el) => el && el.offsetParent !== null)
      .map((el) => {
        const radio = Math.max(14, el.offsetWidth * 0.45);
        return { centro: el.offsetLeft + el.offsetWidth / 2, radio };
      });

  const paso = (t) => {
    const ancho = barra.clientWidth;
    x += 1.35;
    if (x > ancho + 20) x = -26;

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
})();
