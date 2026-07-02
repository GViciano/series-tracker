# Series Tracker

App multiusuario para trackear el progreso de series de TV. Cada usuario tiene su
cuenta, su lista de series, y su propio progreso de episodios vistos.

## Funcionalidades

- Login/registro por usuario (Supabase Auth)
- Buscar series (datos de TMDB) y añadirlas a tu lista
- Listado de series ordenable por: últimas vistas, recién añadidas, progreso, nombre
- Filtro por estado: por empezar / viendo / acabadas / abandonadas
- Ficha de cada serie: temporadas y episodios, con nombre, fecha de emisión e imagen (still) cuando TMDB la tiene
- Marcar/desmarcar episodios como vistos
- Banner de "siguiente episodio a ver" calculado automáticamente
- Barra de progreso (episodios vistos / total)

## 1. Configurar TMDB

1. Crea cuenta gratis en https://www.themoviedb.org/signup
2. Ve a Settings → API (https://www.themoviedb.org/settings/api) y solicita una API Key (tipo "Developer")
3. Copia la **API Key (v3 auth)**

## 2. Configurar Supabase

1. Crea un proyecto nuevo en https://supabase.com/dashboard
2. Ve a **SQL Editor** y pega el contenido de `supabase-schema.sql` (incluido en este proyecto), ejecútalo
3. Ve a **Project Settings → API** y copia `Project URL` y `anon public key`
4. (Opcional pero recomendado) En **Authentication → Providers → Email**, puedes desactivar la confirmación por email si quieres pruebas rápidas sin verificar correo

## 3. Variables de entorno

Copia `.env.example` a `.env` y rellena:

```
VITE_SUPABASE_URL=https://tuproyecto.supabase.co
VITE_SUPABASE_ANON_KEY=tu_anon_key
VITE_TMDB_API_KEY=tu_tmdb_key
```

## 4. Desarrollo local

```bash
npm install
npm run dev
```

## 5. Desplegar en GitHub Pages

1. Cambia `base: '/series-tracker/'` en `vite.config.js` si tu repo se llama distinto
2. Instala el helper de despliegue:
   ```bash
   npm install --save-dev gh-pages
   ```
3. Añade a `package.json` en `scripts`:
   ```json
   "predeploy": "npm run build",
   "deploy": "gh-pages -d dist"
   ```
4. Como las variables `VITE_*` se incrustan en el build, tendrás que definirlas como **repository secrets** de GitHub Actions si automatizas el deploy, o simplemente tener tu `.env` local al ejecutar `npm run deploy` manualmente (el build las incrusta en ese momento)
5. Ejecuta:
   ```bash
   npm run deploy
   ```
6. En GitHub → Settings → Pages, selecciona la rama `gh-pages` como origen

⚠️ **Nota de seguridad:** la API key de TMDB quedará visible en el JS del build (como en cualquier SPA estática). Para TMDB esto es aceptable — es una key de solo lectura pensada para uso en cliente y no da acceso a nada sensible. La `anon key` de Supabase también es pública por diseño; la seguridad real la da Row Level Security (ya configurado en `supabase-schema.sql`), que garantiza que cada usuario solo puede leer/escribir sus propios datos.

## Estructura

```
src/
  lib/
    supabase.js       # cliente de Supabase
    tmdb.js            # funciones de la API de TMDB
  context/
    AuthContext.jsx    # estado de sesión/usuario
  components/
    Auth.jsx            # login/registro
    ShowSearch.jsx       # buscador TMDB + añadir serie
    ShowList.jsx          # listado con orden/filtro
    ShowDetail.jsx          # temporadas/episodios + marcar visto
  App.jsx
supabase-schema.sql    # esquema SQL a ejecutar en Supabase
```

## Posibles mejoras futuras

- Caché de episodios en Supabase para no depender de llamadas repetidas a TMDB
- Notificaciones cuando sale un episodio nuevo de una serie que sigues
- Vista de calendario de estrenos
- Compartir progreso o listas con amigos
