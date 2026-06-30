# BotizLab — web personal / de marca

Sitio estático (HTML/CSS/JS, sin build) pensado para **GitHub Pages**.

## Estructura
```
index.html            Portada (hero, proyectos, blog, sobre mí, contacto)
blog.html             Índice del blog
blog/bienvenida.html  Primer post (plantilla para los siguientes)
css/styles.css        Tema oscuro tech
js/main.js            Menú móvil, año, animaciones
assets/favicon.svg    Icono
.nojekyll             Evita que GitHub procese el sitio con Jekyll
```

## Publicar en GitHub Pages (URL: https://botizlab.github.io)
La forma más sencilla es un repo especial llamado **`botizlab.github.io`**:

1. Crea en GitHub un repo **público** llamado exactamente `botizlab.github.io` (en la cuenta/organización `botizlab`).
2. Sube estos archivos a la rama `main` (raíz del repo).
3. En el repo → **Settings → Pages** → Source: **Deploy from a branch** → Branch: **main** / **/(root)** → Save.
4. En 1-2 minutos estará en **https://botizlab.github.io**.

## Añadir un post nuevo al blog
1. Copia `blog/bienvenida.html` y renómbralo (ej. `blog/mi-segundo-post.html`).
2. Cambia el `<title>`, la fecha, el `<h1>` y el contenido.
3. En `blog.html` (y opcionalmente en `index.html`), duplica el bloque
   `<a class="post-card">…</a>` apuntando al archivo nuevo.

## Cosas que puedes personalizar
- **Email de contacto**: en `index.html`, el `mailto:` (ahora `mrjokyjok@gmail.com`).
- **Proyectos**: añade más tarjetas `<article class="card">` en `index.html`.
- **Colores**: variables `--accent` / `--accent-2` al principio de `css/styles.css`.
- **Enlace de Google Play de GymSpeak**: funcionará cuando la app esté pública.
