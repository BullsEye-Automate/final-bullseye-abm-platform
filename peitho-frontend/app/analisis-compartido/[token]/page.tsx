import { fetchPublicAnalysis } from "@/lib/peithoBackend";
import AnalysisView from "@/components/AnalysisView";

// Página pública (11-09-2026, pedido explícito del usuario) — el link que se
// comparte con el cliente externo (ShareAnalysisButton) resuelve acá. Sin
// login (ver middleware.ts, PUBLIC_PAGE_PREFIXES) y sin Sidebar (ver
// AppShell.tsx): quien la abre solo ve el análisis/feedback de ESTA reunión,
// nada más de Peitho. fetchPublicAnalysis pega directo a
// GET /public/analysis/:token en el backend (sin auth), que ya solo
// devuelve los campos mínimos — no hay nada que ocultar acá además de eso.
function formatDate(value: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleString("es-CL", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "America/Santiago",
  });
}

export default async function SharedAnalysisPage({ params }: { params: { token: string } }) {
  const data = await fetchPublicAnalysis(params.token);

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8" style={{ background: "#FAF8FC" }}>
        <div className="max-w-sm text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-peitho-icon-crop.png" alt="" className="h-8 w-auto object-contain mx-auto mb-4" />
          <h1 className="text-lg font-semibold text-gray-900 mb-1.5">Este link ya no está disponible</h1>
          <p className="text-sm text-gray-500">
            Puede haber sido revocado, o el análisis todavía no se generó para esta reunión. Pedile un link nuevo a
            quien te lo compartió.
          </p>
        </div>
      </div>
    );
  }

  const empresa = data.empresa_nombre ?? data.empresa_contraparte;

  return (
    <div className="min-h-screen" style={{ background: "#FAF8FC" }}>
      <div className="max-w-3xl mx-auto px-6 py-10 space-y-6">
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-peitho-icon-crop.png" alt="" className="h-6 w-auto object-contain" />
          <div className="text-base font-bold tracking-tight leading-none">
            <span style={{ color: "#1C1530" }}>Peit</span>
            <span style={{ color: "#251762" }}>ho</span>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">
            Feedback de la reunión
          </p>
          <h1 className="text-xl font-semibold text-gray-900">
            {data.contraparte ?? "Reunión"}
            {empresa ? ` — ${empresa}` : ""}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {[formatDate(data.start_time), data.contacto_cargo].filter(Boolean).join(" · ")}
          </p>
        </div>

        <AnalysisView analysis={data.analysis} ejecutivo={data.ejecutivo} />

        <p className="text-xs text-gray-400 text-center pt-2">
          Preparado con Peitho, de BullsEye. Este link solo muestra el análisis de esta reunión.
        </p>
      </div>
    </div>
  );
}
