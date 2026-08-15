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

  // ── Validación campo a campo ──────────────────────────────────────────────
  // Estas reglas son las MISMAS que las CHECK de la tabla. Si aquí se dejara
  // pasar algo que allí se rechaza, el visitante escribiría el mensaje entero
  // para que luego el servidor lo tirase con un error que no dice nada.
  //   nombre  1..80   ·  email 5..120 y con forma de correo
  //   asunto  2..140  ·  mensaje 10..2000
  const CORREO = /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/;

  const REGLAS = {
    nombre: (v) =>
      !v ? 'Dime cómo te llamas.'
      : v.length < 2 ? 'Con una sola letra no me vale.'
      : v.length > 80 ? 'Máximo 80 caracteres.'
      : null,
    email: (v) =>
      !v ? 'Sin tu correo no puedo contestarte.'
      : !CORREO.test(v) ? 'Eso no parece un correo. Revisa la arroba y el punto.'
      : v.length > 120 ? 'Máximo 120 caracteres.'
      : null,
    asunto: (v) =>
      !v ? 'Ponle un asunto, aunque sea corto.'
      : v.length < 2 ? 'Un poco más largo.'
      : v.length > 140 ? 'Máximo 140 caracteres.'
      : null,
    mensaje: (v) =>
      !v ? 'Escribe el mensaje.'
      : v.length < 10 ? `Cuéntame algo más: faltan ${10 - v.length} caracteres.`
      : v.length > 2000 ? 'Máximo 2000 caracteres.'
      : null
  };

  const campo = (n) => form.elements[n];
  const hueco = (n) => document.getElementById('e-' + n);

  /** Devuelve true si el campo está bien. `pintar` decide si además se marca. */
  function revisar(nombre, pintar = true) {
    const el = campo(nombre);
    const fallo = REGLAS[nombre](el.value.trim());
    if (pintar) {
      hueco(nombre).textContent = fallo || '';
      el.classList.toggle('malo', !!fallo);
      el.setAttribute('aria-invalid', fallo ? 'true' : 'false');
    }
    return !fallo;
  }

  for (const nombre of Object.keys(REGLAS)) {
    const el = campo(nombre);
    // Al salir del campo se revisa; mientras se escribe solo se corrige lo que
    // ya estaba marcado, para no ir regañando letra a letra
    el.addEventListener('blur', () => revisar(nombre));
    el.addEventListener('input', () => {
      if (el.classList.contains('malo')) revisar(nombre);
    });
  }

  // Contador del mensaje: aparece cuando de verdad importa
  const contador = document.getElementById('contador');
  const texto = campo('mensaje');
  const actualizarContador = () => {
    const n = texto.value.trim().length;
    contador.textContent = n === 0 ? '' : n < 10 ? `${n}/10 mínimo` : `${n}/2000`;
    contador.classList.toggle('apurado', n > 1900);
  };
  texto.addEventListener('input', actualizarContador);
  actualizarContador();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const datos = Object.fromEntries(new FormData(form));

    // Un robot rellena todos los campos, incluido el que no se ve. Fingimos
    // que ha ido bien: si le decimos que ha fallado, lo reintenta.
    if (datos.web) { decir('Mensaje enviado. Te contesto en cuanto lo lea.', 'ok'); form.reset(); return; }

    // Nadie escribe un mensaje entero en tres segundos
    if (Date.now() - abierto < 3000) { decir('Tómate un segundo más y dale otra vez.', 'mal'); return; }

    // Se revisan TODOS, no se para en el primero: así ves de golpe todo lo que
    // hay que arreglar en vez de descubrirlo de uno en uno
    const malos = Object.keys(REGLAS).filter((n) => !revisar(n));
    if (malos.length) {
      decir(malos.length === 1 ? 'Falta un campo por corregir.' : `Faltan ${malos.length} campos por corregir.`, 'mal');
      campo(malos[0]).focus();
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
        Object.keys(REGLAS).forEach((n) => {
          hueco(n).textContent = '';
          campo(n).classList.remove('malo');
          campo(n).removeAttribute('aria-invalid');
        });
        actualizarContador();
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
