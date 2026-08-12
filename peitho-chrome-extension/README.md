# Peitho — Extensión de Chrome (Tarea 4)

Detecta cuando el ejecutivo entra a una reunión de Google Meet que está registrada en Peitho (Tarea 2) y captura el audio de la pestaña automáticamente, sin unirse como participante — no aparece ningún bot en la llamada.

## Cómo funciona

1. `background.js` (service worker) detecta cuando una pestaña navega a `meet.google.com/{codigo}`.
2. Le pregunta al backend (`GET /meetings/lookup?meet_code={codigo}`) si esa reunión está registrada y con `auto_capture=true`.
3. Si corresponde, usa `chrome.tabCapture` para conseguir un `streamId` de esa pestaña y arranca un **offscreen document** (`offscreen.html`/`offscreen.js`) — la grabación en sí ocurre ahí, porque el service worker no tiene acceso a `MediaRecorder`/`getUserMedia`.
4. Cuando la pestaña se cierra, `offscreen.js` termina la grabación y sube el audio a `POST /meetings/{id}/audio`.

## Instalar en Chrome (modo desarrollador)

1. Abre `chrome://extensions`
2. Activa **"Modo de desarrollador"** (interruptor arriba a la derecha)
3. Click en **"Cargar descomprimida"** ("Load unpacked")
4. Selecciona esta carpeta (`peitho-chrome-extension/`)
5. Debería aparecer "Peitho — Captura de reuniones" en la lista, sin errores

Si editas el código, vuelve a `chrome://extensions` y dale click al ícono de recargar (🔄) en la tarjeta de la extensión.

## Requisito: el backend corriendo en localhost

La extensión apunta a `http://localhost:3001` (constante `BACKEND_URL` en `background.js` y `offscreen.js`). Como la extensión corre en tu propio Chrome, **no necesitas ngrok para esta parte** — solo que `npm run dev` esté corriendo en `peitho-backend/`.

## Probarlo

1. Con el backend corriendo (`npm run dev` en `peitho-backend/`) y la extensión cargada
2. Ve a `chrome://extensions`, busca la extensión, y click en **"Service worker"** (o "Inspeccionar vistas") para abrir su consola — ahí van a aparecer los logs `[Peitho] ...`
3. Abre una pestaña nueva y entra al link de Meet de una reunión que ya esté en la tabla `meetings` (ej. `https://meet.google.com/qxu-axoo-ybe`, la de la Tarea 2/3)
4. En la consola del service worker deberías ver:
   ```
   [Peitho] Capturando audio de la pestaña <id> (reunión <meeting_id>)
   ```
5. Habla unos segundos frente al micrófono (o deja sonar algo en la pestaña) para generar audio real
6. Cierra la pestaña de Meet
7. En la consola del service worker (o la del offscreen document, visible también en `chrome://extensions` → "Inspeccionar vistas") deberías ver:
   ```
   [Peitho] Audio de la reunión <meeting_id> subido correctamente
   ```
8. Verifica en la terminal de `npm run dev` que apareció:
   ```
   [audio] guardado .../uploads/<meeting_id>-<timestamp>.webm para la reunión <meeting_id>
   ```
9. Confirma en Supabase → Table Editor → `meetings` que esa fila cambió `status` a `captured` y tiene `audio_path` con una ruta

**Nota:** el archivo `.webm` queda guardado en `peitho-backend/uploads/` en tu Mac (no se sube a git). La transcripción y el análisis de ese audio son la Tarea 5, todavía no están implementados — por ahora solo se guarda.

## Limitaciones conocidas del MVP

- El `meet_code` se valida con un regex simple (`xxx-xxxx-xxx`) — si Google cambia el formato de sus códigos, hay que ajustarlo.
- Si Chrome se cierra abruptamente (crash) en medio de una grabación, el audio no se sube — no hay recuperación automática.
- No hay ícono ni UI visible para el ejecutivo — la extensión es completamente silenciosa, tal como pide el diseño (sin bot visible en la llamada).
