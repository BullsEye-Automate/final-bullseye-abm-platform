# Peitho — Extensión de Chrome (Tarea 4)

Detecta cuando el ejecutivo entra a una reunión de Google Meet que está registrada en Peitho (Tarea 2) y captura el audio de la pestaña — sin unirse como participante, no aparece ningún bot en la llamada.

## Cómo funciona

1. `background.js` (service worker) detecta cuando una pestaña navega a `meet.google.com/{codigo}`.
2. Le pregunta al backend (`GET /meetings/lookup?meet_code={codigo}`) si esa reunión está registrada y con `auto_capture=true`.
3. Si corresponde, pone el ícono de la extensión en **celeste** — la reunión está detectada y lista para grabar.
4. **El ejecutivo hace un clic en el ícono de la extensión** para arrancar la grabación. Esto es obligatorio: Chrome exige un gesto explícito del usuario para autorizar `chrome.tabCapture` — ninguna extensión puede activarlo 100% en automático desde el background, es una restricción de seguridad de la plataforma, no algo que se pueda evitar con código. El ícono se pone **rojo** mientras está grabando.
5. La grabación en sí ocurre en un **offscreen document** (`offscreen.html`/`offscreen.js`), porque el service worker no tiene acceso a `MediaRecorder`/`getUserMedia`.
6. Cuando la pestaña se cierra, `offscreen.js` termina la grabación y sube el audio a `POST /meetings/{id}/audio`.

## Instalar en Chrome (modo desarrollador)

1. Abre `chrome://extensions`
2. Activa **"Modo de desarrollador"** (interruptor arriba a la derecha)
3. Click en **"Cargar descomprimida"** ("Load unpacked")
4. Selecciona esta carpeta (`peitho-chrome-extension/`)
5. Debería aparecer "Peitho — Captura de reuniones" en la lista, sin errores

Si editas el código, vuelve a `chrome://extensions` y dale click al ícono de recargar (🔄) en la tarjeta de la extensión.

## Configuración de una sola vez: permiso de micrófono

La extensión graba **ambos lados** de la conversación: el audio de la pestaña (lo que escuchas) y tu propio micrófono, mezclados en un solo archivo. Para que esto funcione hay que conceder el permiso de micrófono **una sola vez** (no hay que repetirlo en cada reunión):

1. Con la extensión ya cargada en `chrome://extensions`, copia el ID de la extensión (aparece bajo el nombre, algo como `abcdefghijklmnopabcdefghijklmnop`)
2. Abre una pestaña nueva con la URL `chrome-extension://<ID>/mic-permission.html`
3. Click en **"Permitir acceso al micrófono"** y acepta el permiso que pide Chrome
4. Debería aparecer "✅ Listo — ya puedes cerrar esta pestaña." — ciérrala

**¿Por qué este paso extra?** El offscreen document (donde ocurre la grabación real) no tiene interfaz visible, así que no puede mostrar el diálogo de permiso de Chrome. Concediendo el permiso una vez desde esta pestaña normal, queda guardado para el origen de la extensión y el offscreen document puede usarlo después sin volver a preguntar.

Si te saltas este paso, la extensión sigue grabando (solo el audio entrante de la pestaña, no tu voz) y te vas a encontrar con: (a) el análisis solo muestra contenido de "Ejecutivo" y nada de "Contraparte", y (b) el otro participante deja de escucharte a ti — ver la nota siguiente.

## Requisito: el backend corriendo en localhost

La extensión apunta a `http://localhost:3001` (constante `BACKEND_URL` en `background.js` y `offscreen.js`). Como la extensión corre en tu propio Chrome, **no necesitas ngrok para esta parte** — solo que `npm run dev` esté corriendo en `peitho-backend/`.

## Probarlo

1. Con el backend corriendo (`npm run dev` en `peitho-backend/`) y la extensión cargada
2. Ve a `chrome://extensions`, busca la extensión, y click en **"Service worker"** (o "Inspeccionar vistas") para abrir su consola — ahí van a aparecer los logs `[Peitho] ...`
3. Abre una pestaña nueva y entra al link de Meet de una reunión que ya esté en la tabla `meetings` (ej. `https://meet.google.com/qxu-axoo-ybe`, la de la Tarea 2/3)
4. En la consola del service worker deberías ver:
   ```
   [Peitho] Reunión <meeting_id> detectada en la pestaña <id> — click en el ícono de la extensión para empezar a grabar
   ```
   y el ícono de la extensión (en la barra de herramientas, puede estar escondido bajo el ícono del rompecabezas 🧩) debería tener un punto **celeste**.
5. **Haz click en el ícono de la extensión.** En la consola deberías ver:
   ```
   [Peitho] Capturando audio de la pestaña <id> (reunión <meeting_id>)
   ```
   y el punto del ícono cambia a **rojo**.
6. Habla unos segundos frente al micrófono (o deja sonar algo en la pestaña) para generar audio real
7. Cierra la pestaña de Meet
8. En la consola del service worker (o la del offscreen document, visible también en `chrome://extensions` → "Inspeccionar vistas") deberías ver:
   ```
   [Peitho] Audio de la reunión <meeting_id> subido correctamente
   ```
9. Verifica en la terminal de `npm run dev` que apareció:
   ```
   [audio] guardado .../uploads/<meeting_id>-<timestamp>.webm para la reunión <meeting_id>
   ```
10. Confirma en Supabase → Table Editor → `meetings` que esa fila cambió `status` a `captured` y tiene `audio_path` con una ruta

**Nota:** el archivo `.webm` queda guardado en `peitho-backend/uploads/` en tu Mac (no se sube a git). La transcripción y el análisis de ese audio son la Tarea 5, todavía no están implementados — por ahora solo se guarda.

## Importante: capturar el audio de la pestaña la desconecta de los parlantes

`chrome.tabCapture`/`getUserMedia({chromeMediaSource:'tab'})` **redirige** el audio de la pestaña — por defecto deja de sonar en tus parlantes normales mientras se captura (bug real que se detectó probando: el ejecutivo dejaba de escuchar a la otra persona en la llamada). El offscreen document reconecta ese audio a los parlantes con la Web Audio API (`AudioContext.destination`) además de mandarlo a la grabación, así que si instalaste una versión de la extensión posterior a este fix, deberías poder escuchar la llamada con normalidad mientras se graba. Si en algún momento notas que dejas de escuchar al otro participante al empezar a grabar, es señal de que este mecanismo se rompió — no lo ignores, revisa `offscreen.js`.

## Limitaciones conocidas del MVP

- El `meet_code` se valida con un regex simple (`xxx-xxxx-xxx`) — si Google cambia el formato de sus códigos, hay que ajustarlo.
- Si Chrome se cierra abruptamente (crash) en medio de una grabación, el audio no se sube — no hay recuperación automática.
- **Requiere un clic del ejecutivo para arrancar la grabación** (ver "Cómo funciona" arriba) — no es 100% automático de punta a punta. No aparece ningún bot en la llamada (eso sí se cumple), pero sí hay que fijarse en el ícono celeste y hacerle clic. Si esto es un problema para el flujo real, se puede explorar más adelante mostrar una notificación de Chrome (`chrome.notifications`) para que sea más visible que solo el ícono.
- **Si el ejecutivo nunca hace la configuración de una sola vez de micrófono** (ver sección arriba), la extensión sigue funcionando pero solo graba el audio entrante — no hay forma de detectar esto automáticamente y avisar en la UI todavía, solo queda un `console.warn` en la consola del offscreen document.
- La mezcla de audio (tab + mic) va a un solo canal — todavía no hay separación por canal/estéreo, así que la diarización sigue dependiendo del heurístico "primer hablante = Ejecutivo" de Deepgram (ver `peitho-backend/CLAUDE.md`).
