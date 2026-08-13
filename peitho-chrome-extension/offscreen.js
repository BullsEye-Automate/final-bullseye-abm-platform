// Cambiar esto cuando el backend deje de correr en localhost (ej. al desplegar a Railway/Render).
const BACKEND_URL = 'http://localhost:3001';

let mediaRecorder = null;
let audioContext = null;
let rawStreams = []; // streams "crudos" (tab + mic) que hay que cerrar al terminar
let chunks = [];
let currentMeetingId = null;

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'peitho:start-capture') {
    startRecording(message.streamId, message.meetingId);
  } else if (message.type === 'peitho:stop-capture') {
    stopRecording();
  }
});

async function startRecording(streamId, meetingId) {
  currentMeetingId = meetingId;
  chunks = [];
  rawStreams = [];

  const tabStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    },
    video: false,
  });
  rawStreams.push(tabStream);

  // El micrófono requiere permiso que un offscreen document no puede pedir
  // solo (no tiene UI). Si el usuario ya lo concedió una vez en
  // mic-permission.html, esto funciona sin volver a preguntar. Si no,
  // seguimos igual grabando solo el audio de la pestaña (mejor eso que nada).
  let micStream = null;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    rawStreams.push(micStream);
  } catch (error) {
    console.warn(
      `[Peitho] No se pudo acceder al micrófono — solo se va a grabar el audio entrante de la llamada. ` +
        `Corre la configuración de una vez en chrome-extension://${chrome.runtime.id}/mic-permission.html`,
      error
    );
  }

  audioContext = new AudioContext();
  const destination = audioContext.createMediaStreamDestination();

  // Capturar el audio de la pestaña lo desvía de los parlantes normales —
  // sin reconectarlo, el ejecutivo deja de escuchar a la otra persona mientras graba.
  const tabSource = audioContext.createMediaStreamSource(tabStream);
  tabSource.connect(destination);
  tabSource.connect(audioContext.destination);

  if (micStream) {
    const micSource = audioContext.createMediaStreamSource(micStream);
    micSource.connect(destination);
  }

  mediaRecorder = new MediaRecorder(destination.stream, { mimeType: 'audio/webm' });
  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  mediaRecorder.onstop = uploadRecording;
  mediaRecorder.start();
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
}

async function uploadRecording() {
  rawStreams.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
  rawStreams = [];

  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }

  const meetingId = currentMeetingId;
  const blob = new Blob(chunks, { type: 'audio/webm' });
  chunks = [];
  currentMeetingId = null;
  mediaRecorder = null;

  if (!meetingId || blob.size === 0) return;

  const formData = new FormData();
  formData.append('audio', blob, `${meetingId}.webm`);

  try {
    const res = await fetch(`${BACKEND_URL}/meetings/${meetingId}/audio`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      console.error('[Peitho] El backend rechazó el audio', await res.text());
    } else {
      console.log(`[Peitho] Audio de la reunión ${meetingId} subido correctamente`);
    }
  } catch (error) {
    console.error('[Peitho] Error de red subiendo el audio', error);
  }
}
