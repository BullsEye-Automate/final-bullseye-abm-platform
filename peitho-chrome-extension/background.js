// Cambiar esto cuando el backend deje de correr en localhost (ej. al desplegar a Railway/Render).
const BACKEND_URL = 'http://localhost:3001';

// tabId -> { meetingId } — reuniones que esta pestaña ya está capturando
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

async function startCapture(tabId, meetingId) {
  if (capturingTabs.has(tabId)) return; // ya se está capturando esta pestaña

  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  await ensureOffscreenDocument();

  chrome.runtime.sendMessage({
    type: 'peitho:start-capture',
    streamId,
    meetingId,
  });

  capturingTabs.set(tabId, { meetingId });
  console.log(`[Peitho] Capturando audio de la pestaña ${tabId} (reunión ${meetingId})`);
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return;

  const meetCode = extractMeetCode(changeInfo.url);
  if (!meetCode) return;

  try {
    const result = await lookupMeeting(meetCode);
    if (result.registered && result.auto_capture) {
      await startCapture(tabId, result.meeting_id);
    }
  } catch (error) {
    console.error('[Peitho] Error consultando /meetings/lookup', error);
  }
});

// La pestaña se cerró (o navegó a otro lado) — termina la grabación si corresponde.
chrome.tabs.onRemoved.addListener((tabId) => {
  const capture = capturingTabs.get(tabId);
  if (!capture) return;

  capturingTabs.delete(tabId);
  chrome.runtime.sendMessage({ type: 'peitho:stop-capture', meetingId: capture.meetingId });
  console.log(`[Peitho] Pestaña ${tabId} cerrada, terminando captura de la reunión ${capture.meetingId}`);
});
