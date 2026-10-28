import Link from "next/link";
import { getPortalUser } from "@/lib/portalAuth";
import { supabaseAdmin } from "@/lib/supabase";
import { loadClientSettings, loadRadarConfig, loadSnapshot } from "@/lib/radarAbm/server/store";
import { compute, N, P, dmy } from "@/lib/radarAbm/engine";
import { isPortalClientActive } from "@/lib/radarAbm/server/masterClients";
import { PART_SLUGS } from "@/lib/radarAbm/render";

export const dynamic = "force-dynamic";

// Inicio del portal: resumen del Pulso ABM de la cuenta (si ya está
// sincronizado) y accesos a ICP y wishlist.
export default async function PortalHomePage() {
  const user = await getPortalUser();
  if (!user) return null; // el layout ya muestra el mensaje de sin acceso

  const db = supabaseAdmin();
  const [{ count: pendingIcp }, { count: wishlistCount }, { count: proposals }, radar] = await Promise.all([
    db.from("icp_change_requests").select("id", { count: "exact", head: true }).eq("client_id", user.clientId).eq("status", "pending"),
    db.from("client_wishlist").select("id", { count: "exact", head: true }).eq("client_id", user.clientId),
    db.from("client_wishlist").select("id", { count: "exact", head: true }).eq("client_id", user.clientId).eq("status", "proposed"),
    loadRadarSummary(user.clientId, user.clientName),
  ]);

  const firstName = user.fullName?.split(" ")[0];

  return (
    <div>
      <h1 className="text-2xl font-semibold" style={{ color: "#251762" }}>
        Hola{firstName ? `, ${firstName}` : ""} 👋
      </h1>
      <p className="text-sm text-gray-500 mt-1 mb-6">
        Este es el portal de {user.clientName} en BullsEye: el estado de tus cuentas objetivo, tu ICP y las empresas que quieres trabajar.
      </p>

      {radar ? (
        <Link href="/portal/radar" className="block bg-white rounded-2xl border border-gray-100 p-5 mb-6 hover:border-[#62E0D8] transition">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <h2 className="font-semibold text-[15px]" style={{ color: "#251762" }}>Pulso ABM · resumen</h2>
            <span className="text-xs text-gray-400">Actualizado {radar.syncedAt} · corte {radar.cut}</span>
          </div>
          <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
            <Kpi label="Health Score" value={String(radar.score)} sub={radar.band} highlight />
            <Kpi label="Cobertura de cuentas" value={radar.coverage} sub={`${radar.worked} de ${radar.universe} empresas`} />
            <Kpi label="Contactabilidad" value={radar.contactRate} sub="efectivos / gestionados" />
            <Kpi label="Reuniones realizadas" value={radar.held} sub={`${radar.scheduled} agendadas`} />
            <Kpi label="Oportunidades" value={radar.opp} sub="empresas con oportunidad" />
          </div>
          <div className="text-xs mt-4 font-medium" style={{ color: "#3D2878" }}>Ver informe completo →</div>
        </Link>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        {!radar && (
          <Card href={`/portal/radar?vista=${PART_SLUGS[0]}`} title="Pulso ABM" body="Qué está pasando en tus cuentas objetivo: cobertura, conversaciones, reuniones, oportunidades e inteligencia de mercado." />
        )}
        <Card
          href="/portal/icp"
          title="ICP y buyer persona"
          body="Revisa el perfil de cliente ideal con el que estamos prospectando y propón ajustes."
          badge={pendingIcp ? `${pendingIcp} propuesta${pendingIcp > 1 ? "s" : ""} en revisión` : undefined}
        />
        <Card
          href="/portal/radar?vista=cuentas-objetivo"
          title="Cuentas objetivo"
          body="Aprueba las empresas que te propone BullsEye, busca empresas con filtros y arma tu wishlist."
          badge={
            proposals
              ? `${proposals} propuesta${proposals > 1 ? "s" : ""} por aprobar`
              : wishlistCount
                ? `${wishlistCount} empresa${wishlistCount > 1 ? "s" : ""} en tu wishlist`
                : undefined
          }
        />
      </div>
    </div>
  );
}

// Resumen del informe con el mismo cálculo del Pulso ABM. Si no hay
// sincronización o el informe está oculto para el cliente, no se muestra.
async function loadRadarSummary(clientId: string, clientName: string) {
  try {
    const [settings, snapshot, config] = await Promise.all([loadClientSettings(clientId), loadSnapshot(clientId), loadRadarConfig()]);
    if (!settings.portal_enabled || !snapshot) return null;
    if (!(await isPortalClientActive(clientId, clientName))) return null;
    const M = compute(snapshot.dataset, config);
    return {
      score: M.health.score,
      band: M.health.band[0] as string,
      coverage: P(M.kpi.coverage),
      worked: N(M.kpi.worked),
      universe: N(M.kpi.universe),
      contactRate: P(M.kpi.contactRate),
      held: N(M.held.length),
      scheduled: N(M.Mt.length),
      opp: N(M.kpi.opp),
      cut: dmy(snapshot.dataset.generated),
      syncedAt: new Date(snapshot.synced_at).toLocaleDateString("es-CL", { timeZone: "America/Santiago" }),
    };
  } catch (e) {
    console.error("Portal: no se pudo armar el resumen del Pulso ABM:", e);
    return null;
  }
}

function Kpi({ label, value, sub, highlight }: { label: string; value: string; sub: string; highlight?: boolean }) {
  return (
    <div className="rounded-xl p-3" style={{ background: highlight ? "rgba(98,224,216,0.15)" : "#F8F7FC" }}>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-2xl font-semibold mt-1" style={{ color: "#1A1733" }}>{value}</div>
      <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>
    </div>
  );
}

function Card({ href, title, body, badge }: { href: string; title: string; body: string; badge?: string }) {
  return (
    <Link href={href}>
      <div className="h-full bg-white rounded-2xl border border-gray-100 p-5 hover:border-[#62E0D8] transition">
        <h2 className="font-semibold text-[15px] mb-2" style={{ color: "#251762" }}>{title}</h2>
        <p className="text-sm text-gray-500 leading-relaxed">{body}</p>
        {badge && (
          <div className="mt-3 inline-block text-xs font-medium rounded-full px-2.5 py-1" style={{ background: "rgba(98,224,216,0.15)", color: "#1b8f88" }}>
            {badge}
          </div>
        )}
      </div>
    </Link>
  );
}
