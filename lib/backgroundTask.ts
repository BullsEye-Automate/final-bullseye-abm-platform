// Tareas en segundo plano dentro de una invocación de Vercel.
//
// Las rutas que reparten trabajo por cliente (ej. /api/cron/radar-abm-sync)
// lanzaban cada cliente con fetch y cortaban la espera a los pocos segundos.
// En Vercel, cortar la conexión puede terminar la invocación del cliente
// antes de que acabe: el sync quedaba "started" para siempre. Con waitUntil
// la invocación responde al instante y sigue trabajando hasta terminar (o
// hasta su maxDuration), sin depender de que alguien espere la respuesta.
//
// Es lo mismo que hace waitUntil de @vercel/functions (lee el contexto de la
// request que deja Vercel), sin sumar la dependencia. Fuera de Vercel no hay
// contexto: se devuelve false y quien llama debe esperar la tarea.
type VercelCtx = { waitUntil?: (p: Promise<unknown>) => void };

export function runInBackground(task: Promise<unknown>): boolean {
  const g = globalThis as unknown as Record<symbol, { get?: () => VercelCtx } | undefined>;
  const ctx = g[Symbol.for("@vercel/request-context")]?.get?.();
  if (!ctx?.waitUntil) return false;
  ctx.waitUntil(task.catch(() => {}));
  return true;
}
