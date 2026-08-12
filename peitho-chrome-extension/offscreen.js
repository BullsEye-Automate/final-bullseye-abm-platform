// Cambiar esto cuando el backend deje de correr en localhost (ej. al desplegar a Railway/Render).
const BACKEND_URL = 'http://localhost:3001';

let mediaRecorder = null;
let currentStream = null;
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

  currentStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    },
    video: false,
  });

  mediaRecorder = new MediaRecorder(currentStream, { mimeType: 'audio/webm' });
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
  if (currentStream) {
    currentStream.getTracks().forEach((track) => track.stop());
    currentStream = null;
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
