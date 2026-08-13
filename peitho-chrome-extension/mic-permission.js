document.getElementById('grant').addEventListener('click', async () => {
  const status = document.getElementById('status');
  status.textContent = 'Pidiendo permiso...';

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Solo necesitábamos que el navegador registrara el permiso — no hace
    // falta mantener el stream abierto acá.
    stream.getTracks().forEach((track) => track.stop());

    await chrome.storage.local.set({ micPermissionGranted: true });
    status.textContent = '✅ Listo — ya puedes cerrar esta pestaña.';
  } catch (error) {
    status.textContent = `❌ No se pudo obtener el permiso: ${error.message}`;
  }
});
