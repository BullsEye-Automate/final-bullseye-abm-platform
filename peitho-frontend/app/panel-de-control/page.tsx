import { fetchMe, fetchClients } from "@/lib/peithoBackend";
import PanelDeControlView from "@/components/PanelDeControlView";

// Paso 6 — Panel de control tipo CRM. Ver comentario en
// peitho-backend/src/routes/panel.ts: el funnel y los KPIs se calculan con
// señales que Peitho ya tiene (prediccion_exito, contacto_cargo/industria del
// excel de metas) como proxy de conversión — no hay integración con
// HubSpot todavía, así que no se muestra tasa de conversión real de negocio.
export default async function PanelDeControlPage() {
  const me = await fetchMe();
  if (!me) {
    return <p className="text-sm text-gray-500">Tu cuenta todavía no tiene acceso a Peitho — contacta al administrador.</p>;
  }
  const isAdmin = me.role === "admin";
  const clients = isAdmin ? await fetchClients() : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Panel de control</h1>
        <p className="text-sm text-gray-500 mt-1">
          Funnel de reuniones y predicción de éxito por cargo/industria del contacto.
        </p>
      </div>
      <PanelDeControlView isAdmin={isAdmin} clients={clients} />
    </div>
  );
}
