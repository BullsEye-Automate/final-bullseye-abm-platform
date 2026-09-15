// Bug real (15-09-2026): con varias reuniones de clientes agendadas cerca en
// el tiempo, el webhook de Recall (POST /webhooks/recall) puede recibir dos o
// más avisos de "bot.done" casi al mismo tiempo — cada uno dispara
// processRecallDone(), que baja el audio COMPLETO de la reunión a memoria
// (Buffer.from(await audioRes.arrayBuffer())) antes de guardarlo. Sin ningún
// límite, dos o más reuniones de ~1h terminando cerca reventaban la RAM del
// contenedor al mismo tiempo — el mismo patrón que ya causó un OOM real antes
// (ver everyGuarded en server.ts), pero esta vez entre llamadas de ORIGEN
// DISTINTO (dos webhooks en vivo, o un webhook en vivo + el reintento
// periódico de reuniones pegadas) que ese guard no cubre, porque
// everyGuarded solo serializa un job contra SÍ MISMO entre ticks, no contra
// llamadas disparadas desde otro lado (un webhook, un botón manual).
//
// Este limitador es global y no depende de qué disparó la llamada — sea un
// webhook en vivo, retryStuckAnalyses, o un botón manual (Reprocesar
// grabación / Reintentar análisis / subida de la extensión de Chrome): como
// máximo una descarga+análisis de audio corre a la vez en todo el proceso;
// cualquier otra simplemente espera su turno en una cola en vez de competir
// por memoria al mismo tiempo. El costo es solo tiempo (una reunión espera
// unos minutos más para procesarse si hay otra por delante), nunca memoria.
const MAX_CONCURRENT_AUDIO_JOBS = 1;

let running = 0;
const queue: Array<() => void> = [];

export function runAudioJob<T>(label: string, fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const task = () => {
      running++;
      fn()
        .then(resolve, reject)
        .finally(() => {
          running--;
          const next = queue.shift();
          if (next) next();
        });
    };
    if (running < MAX_CONCURRENT_AUDIO_JOBS) {
      task();
    } else {
      console.log(`[audio-limiter] ${label}: ya hay ${running} en curso, se encola`);
      queue.push(task);
    }
  });
}
