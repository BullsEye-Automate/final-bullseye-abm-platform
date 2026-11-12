// Backend de producción (Railway) — cambiar a http://localhost:3001 solo si
// estás probando contra tu backend local (npm run dev).
const BACKEND_URL = 'https://final-bullseye-abm-platform-production.up.railway.app';

// tabId -> meetingId — reuniones de Peitho detectadas, esperando el clic del ejecutivo
// para arrancar (Chrome exige un gesto del usuario para autorizar tabCapture).
const readyTabs = new Map();
// tabId -> { meetingId } — reuniones que ya se están grabando de verdad
const capturingTabs = new Map();

// Detecta si una URL de pestaña es una videollamada real reconocible —
// Google Meet (con su código de 3 grupos) o Microsoft Teams (link de
// meetup-join/meet). Pedido explícito del usuario (12-11-2026): el diseño
// original (Tarea 4) solo reconocía Meet agendado en el calendario propio
// del ejecutivo de BullsEye (meet_code) — pero la mayoría de las reuniones
// reales con clientes son invitaciones al bot en el calendario DEL CLIENTE
// (meeting_url en el backend, no meet_code), y varios clientes usan Teams,
// no Meet. Devuelve el parámetro exacto que espera GET /meetings/lookup
// para cada caso: meet_code para Meet (compatibilidad con el diseño
// original), url (la pestaña completa) para Teams — ahí no hay un "código"
// corto que extraer, el backend matchea contra meeting_url normalizado.
function extractMeetingLookupParams(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.hostname === 'meet.google.com') {
    const code = parsed.pathname.replace(/^\//, '');
    // Descarta páginas que no son un código de reunión real (home, /new, /_meet/..., etc.)
    if (!/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(code)) return null;
    return { meet_code: code };
  }

  if (parsed.hostname === 'teams.microsoft.com' || parsed.hostname === 'teams.live.com') {
    if (!/^\/(l\/meetup-join|meet)\//i.test(parsed.pathname)) return null;
    return { url: parsed.href };
  }

  return null;
}

async function lookupMeeting(params) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${BACKEND_URL}/meetings/lookup?${qs}`);
  if (!res.ok) throw new Error(`lookup falló con status ${res.status}`);
  return res.json();
}

async function ensureOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (existing.length > 0) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Grabar el audio de la pestaña de Google Meet y del micrófono',
  });
}

// Un offscreen document no puede mostrar el diálogo de permiso de micrófono
// (no tiene UI visible). Si el usuario lo concede una vez en esta pestaña
// normal de la extensión, el permiso queda guardado para el origen de la
// extensión, y el offscreen document puede usarlo después sin volver a pedirlo.
async function ensureMicPermissionPrompt() {
  const { micPermissionGranted } = await chrome.storage.local.get('micPermissionGranted');
  if (micPermissionGranted) return;
  chrome.tabs.create({ url: chrome.runtime.getURL('mic-permission.html') });
}

// Marca visualmente el ícono de la extensión sobre esta pestaña.
function setBadge(tabId, text, color) {
  chrome.action.setBadgeText({ tabId, text });
  chrome.action.setBadgeBackgroundColor({ tabId, color });
}

async function startCapture(tabId, meetingId) {
  if (capturingTabs.has(tabId)) return; // ya se está capturando esta pestaña

  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  await ensureOffscreenDocument();

  chrome.runtime.sendMessage({
    type: 'peitho:start-capture',
    streamId,
    meetingId,
  });

  readyTabs.delete(tabId);
  capturingTabs.set(tabId, { meetingId });
  setBadge(tabId, '●', '#E05252'); // rojo = grabando
  console.log(`[Peitho] Capturando audio de la pestaña ${tabId} (reunión ${meetingId})`);
}

// Detección automática: solo consulta el backend y deja la reunión "lista para
// grabar" con un ícono celeste. NO arranca chrome.tabCapture acá — Chrome exige
// un gesto del usuario (el clic del ícono) para autorizarlo, no se puede evitar.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return;

  const lookupParams = extractMeetingLookupParams(changeInfo.url);
  if (!lookupParams) return;

  try {
    const result = await lookupMeeting(lookupParams);
    if (result.registered && result.auto_capture) {
      readyTabs.set(tabId, result.meeting_id);
      setBadge(tabId, '●', '#62E0D8'); // celeste = detectada, esperando el clic
      console.log(
        `[Peitho] Reunión ${result.meeting_id} detectada en la pestaña ${tabId} — click en el ícono de la extensión para empezar a grabar`
      );
    }
  } catch (error) {
    console.error('[Peitho] Error consultando /meetings/lookup', error);
  }
});

// El clic en el ícono ES el gesto de usuario que Chrome exige para autorizar tabCapture.
chrome.action.onClicked.addListener(async (tab) => {
  const meetingId = readyTabs.get(tab.id);
  if (!meetingId) {
    console.log('[Peitho] Esta pestaña no tiene ninguna reunión de Peitho lista para capturar.');
    return;
  }

  try {
    await startCapture(tab.id, meetingId);
    await ensureMicPermissionPrompt();
  } catch (error) {
    console.error('[Peitho] Error iniciando la captura', error);
  }
});

// La pestaña se cerró (o navegó a otro lado) — termina la grabación si corresponde.
chrome.tabs.onRemoved.addListener((tabId) => {
  readyTabs.delete(tabId);

  const capture = capturingTabs.get(tabId);
  if (!capture) return;

  capturingTabs.delete(tabId);
  chrome.runtime.sendMessage({ type: 'peitho:stop-capture', meetingId: capture.meetingId });
  console.log(`[Peitho] Pestaña ${tabId} cerrada, terminando captura de la reunión ${capture.meetingId}`);
});
