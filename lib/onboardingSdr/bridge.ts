// Inyecta en la página HTML del onboarding (iframe aislado) los datos que
// necesita: plan, avance del SDR, roles de quien mira, clientes y calendario
// (window.__ONB). Los cambios vuelven a la plataforma por postMessage.

// JSON dentro de <script>: se escapa "<" para que no cierre la etiqueta.
const safeJson = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

export function injectOnboarding(html: string, onb: unknown): string {
  const script = `<script>window.__ONB=${safeJson(onb)};</script>`;
  const head = html.match(/<head[^>]*>/i);
  if (head && head.index !== undefined) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + script + html.slice(at);
  }
  return script + html;
}
