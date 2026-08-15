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
 * Formulario de contacto.
 *
 * No hay servidor: el mensaje se inserta directamente en una tabla de Supabase
 * que solo acepta INSERT. Nadie puede leer los mensajes con esta clave, porque
 * la tabla no tiene política de SELECT y RLS deniega por defecto.
 *
 * La clave anónima es pública POR DISEÑO —ya viaja dentro del APK de Google
 * Play—. Lo que protege los datos no es esconderla, son las políticas de
 * Supabase.
 */
(() => {
  const SUPABASE_URL = 'https://datuqilcshjvapujdool.supabase.co';
  const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRhdHVxaWxjc2hqdmFwdWpkb29sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwNDgxMzIsImV4cCI6MjA5NDYyNDEzMn0.q6AZirRR1UsKKdkxvnmlmPDVQx09T-FckLl03aRh5Gw';

  const form = document.getElementById('formContacto');
  const aviso = document.getElementById('avisoContacto');
  if (!form || !aviso) return;

  const boton = form.querySelector('button[type="submit"]');
  const abierto = Date.now();

  const decir = (texto, clase) => {
    aviso.textContent = texto;
    aviso.className = 'aviso' + (clase ? ' ' + clase : '');
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const datos = Object.fromEntries(new FormData(form));

    // Un robot rellena todos los campos, incluido el que no se ve. Fingimos
    // que ha ido bien: si le decimos que ha fallado, lo reintenta.
    if (datos.web) { decir('Mensaje enviado. Te contesto en cuanto lo lea.', 'ok'); form.reset(); return; }

    // Nadie escribe un mensaje entero en tres segundos
    if (Date.now() - abierto < 3000) { decir('Tómate un segundo más y dale otra vez.', 'mal'); return; }

    if (!form.checkValidity()) {
      decir('Repasa los campos: faltan cosas o el correo no es válido.', 'mal');
      form.reportValidity();
      return;
    }

    boton.disabled = true;
    decir('Enviando…');

    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/mensajes_web`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON,
          Authorization: `Bearer ${SUPABASE_ANON}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal'
        },
        body: JSON.stringify({
          nombre: datos.nombre.trim(),
          email: datos.email.trim(),
          asunto: datos.asunto.trim(),
          mensaje: datos.mensaje.trim()
        })
      });

      if (res.ok) {
        decir('Mensaje enviado. Te contesto en cuanto lo lea.', 'ok');
        form.reset();
        return;
      }

      // Si algo se rechaza, que el aviso diga qué hacer, no un código
      const cuerpo = await res.text();
      if (res.status === 429 || /Demasiados mensajes/i.test(cuerpo)) {
        decir('Ahora mismo no puedo aceptar más mensajes. Prueba dentro de un rato.', 'mal');
      } else if (/check constraint|violates/i.test(cuerpo)) {
        decir('Algún campo se pasa de largo o el correo no es válido.', 'mal');
      } else {
        decir('No se ha podido enviar. Escríbeme al correo de abajo.', 'mal');
      }
    } catch {
      decir('No hay conexión con el servidor. Escríbeme al correo de abajo.', 'mal');
    } finally {
      boton.disabled = false;
    }
  });
})();

/**
 * Los márgenes son la cinta: los travesaños bajan hacia ti según haces scroll.
 *
 * Se desplaza solo dentro de un periodo del patrón (44 px) y se repite: así el
 * número no crece sin fin y el movimiento se ve continuo igual.
 */
(() => {
  const cintas = document.querySelectorAll('.cinta');
  if (!cintas.length) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const PASO = 44;
  let pedido = false;

  const mover = () => {
    const y = ((window.scrollY * 0.55) % PASO).toFixed(2);
    cintas.forEach((c) => { c.style.transform = `translateY(${y}px)`; });
    pedido = false;
  };

  window.addEventListener('scroll', () => {
    if (pedido) return;
    pedido = true;
    requestAnimationFrame(mover);
  }, { passive: true });
})();

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
