# Steam_randomizer — Backlog de Steam

Web estática (pensada para celular) para controlar el backlog de Steam.
Publicada en: <https://esteban-leyton.github.io/Steam_randomizer/>

| Archivo | Para qué sirve |
|---|---|
| `index.html`, `style.css`, `app.js` | La web |
| `data.json` | Tu biblioteca (la genera el script; no se edita a mano) |
| `config.json` | Carpetas propias, horas para «pendiente» y juegos asignados a mano |
| `scripts/update_steam.py` | Lee la API de Steam y escribe `data.json` |
| `.github/workflows/update.yml` | Ejecuta el script cada día (o a mano), hace commit y publica en Pages |

## Carpetas y criterios

Hay tres carpetas principales (**Pendientes**, **Infinitos**, **Por platinar**), que siempre cuentan en los
contadores y en el reparto, y carpetas propias que puedes crear, renombrar y borrar desde la página.
Vienen creadas *Solo online*, *Relleno* y *Ya me los pasé*. Marca **Reparto** en una carpeta propia si quieres que
también cuente en los porcentajes y en el reparto de instalados.

Cada juego está en **una sola** carpeta:

- Si la elegiste a mano en su menú, esa manda.
- Si está en **Auto**: es *pendiente* si tiene menos de X horas (2 por defecto; se cambia en la página y
  0 lo desactiva); si no, *por platinar* si tiene logros sin completar; si no, queda *Sin carpeta*.

Las imágenes de cada juego las obtiene el script de la tienda de Steam (`IStoreBrowseService/GetItems`).

## Despliegue en GitHub Pages

1. **Consigue tus datos de Steam**
   - Clave de API: <https://steamcommunity.com/dev/apikey>.
   - SteamID64 (17 dígitos): aparece en la URL de tu perfil si es `/profiles/7656…`; si usas una URL personalizada, búscalo en <https://steamid.io>.
   - En Steam → Perfil → Editar perfil → Privacidad, pon **Detalles de juegos** en *Público*. Si no, la API no devuelve tu biblioteca.

2. **Guarda los secretos**: en el repo, *Settings → Secrets and variables → Actions → New repository secret*:
   - `STEAM_API_KEY` = tu clave
   - `STEAM_ID` = tu SteamID64

   La clave nunca se sube al código.

3. **Activa Pages**: *Settings → Pages → Build and deployment → Source:* **GitHub Actions**.

4. **Primera ejecución**: pestaña *Actions → "Actualizar datos de Steam y publicar" → Run workflow*.

Después se actualiza solo cada día a las 09:00 UTC. Cada push a `main` vuelve a publicar la web (sin consultar Steam).

## Guardar tus carpetas

Los cambios (juegos movidos, carpetas, horas) se guardan en el `localStorage` de ese navegador.
Para que valgan en todos tus dispositivos: pulsa **Descargar config.json**, sustituye el del repositorio
(desde GitHub: *Add file → Upload files*) y haz commit. El workflow republica la página sola.
**Volver a config.json** borra los cambios locales y usa el archivo del repo.

## Probar en local

`fetch` no funciona abriendo el HTML con doble clic, así que usa un servidor:

```bash
export STEAM_API_KEY=...  STEAM_ID=...
python3 scripts/update_steam.py
python3 -m http.server 8000   # abre http://localhost:8000
```
