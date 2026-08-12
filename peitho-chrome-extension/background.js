// Cambiar esto cuando el backend deje de correr en localhost (ej. al desplegar a Railway/Render).
const BACKEND_URL = 'http://localhost:3001';

// tabId -> meetingId — reuniones de Peitho detectadas, esperando el clic del ejecutivo
// para arrancar (Chrome exige un gesto del usuario para autorizar tabCapture).
const readyTabs = new Map();
// tabId -> { meetingId } — reuniones que ya se están grabando de verdad
const capturingTabs = new Map();

function extractMeetCode(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'meet.google.com') return null;
    const code = parsed.pathname.replace(/^\//, '');
    // Descarta páginas que no son un código de reunión real (home, /new, /_meet/..., etc.)
    if (!/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(code)) return null;
    return code;
  } catch {
    return null;
  }
}

async function lookupMeeting(meetCode) {
  const res = await fetch(`${BACKEND_URL}/meetings/lookup?meet_code=${encodeURIComponent(meetCode)}`);
  if (!res.ok) throw new Error(`lookup falló con status ${res.status}`);
  return res.json();
}

async function ensureOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (existing.length > 0) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Grabar el audio de la pestaña de Google Meet',
  });
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

  const meetCode = extractMeetCode(changeInfo.url);
  if (!meetCode) return;

  try {
    const result = await lookupMeeting(meetCode);
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
