import Link from "next/link";
import { getPortalUser } from "@/lib/portalAuth";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function PortalHomePage() {
  const user = await getPortalUser();
  if (!user) return null; // el layout ya muestra el mensaje de sin acceso

  const { count: pendingIcp } = await supabaseAdmin()
    .from("icp_change_requests")
    .select("id", { count: "exact", head: true })
    .eq("client_id", user.clientId)
    .eq("status", "pending");

  const firstName = user.fullName?.split(" ")[0];

  return (
    <div>
      <h1 className="text-2xl font-semibold" style={{ color: "#251762" }}>
        Hola{firstName ? `, ${firstName}` : ""} 👋
      </h1>
      <p className="text-sm text-gray-500 mt-1 mb-8">
        Este es el portal de {user.clientName} en BullsEye. Desde aquí puedes revisar tu ICP y, muy pronto, armar tu wishlist de empresas.
      </p>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card
          href="/portal/icp"
          title="ICP y buyer persona"
          body="Revisa el perfil de cliente ideal con el que estamos prospectando y propón ajustes."
          badge={pendingIcp ? `${pendingIcp} propuesta${pendingIcp > 1 ? "s" : ""} en revisión` : undefined}
        />
        <Card
          title="Wishlist de empresas"
          body="Busca empresas con filtros o recomendaciones IA según tu ICP y agrégalas a tu wishlist."
          soon
        />
        <Card title="Reportes" body="Resultados de la prospección: actividad, reuniones y oportunidades." soon />
      </div>
    </div>
  );
}

function Card({ href, title, body, badge, soon }: { href?: string; title: string; body: string; badge?: string; soon?: boolean }) {
  const inner = (
    <div className={`h-full bg-white rounded-2xl border border-gray-100 p-5 ${soon ? "opacity-60" : "hover:border-[#62E0D8] transition"}`}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2 className="font-semibold text-[15px]" style={{ color: "#251762" }}>{title}</h2>
        {soon && <span className="text-[10px] uppercase tracking-wide bg-gray-100 text-gray-500 rounded px-1.5 py-0.5">Pronto</span>}
      </div>
      <p className="text-sm text-gray-500 leading-relaxed">{body}</p>
      {badge && (
        <div className="mt-3 inline-block text-xs font-medium rounded-full px-2.5 py-1" style={{ background: "rgba(98,224,216,0.15)", color: "#1b8f88" }}>
          {badge}
        </div>
      )}
    </div>
  );
  return href && !soon ? <Link href={href}>{inner}</Link> : inner;
}
