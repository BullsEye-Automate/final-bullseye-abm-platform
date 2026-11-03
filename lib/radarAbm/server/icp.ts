import { supabaseAdmin } from "@/lib/supabase";
import { listClientIndustries, loadIcpContent } from "@/lib/icpStore";
import { deserializeIcpForm, type IcpFormData } from "@/lib/icp-form";

// ICP vigente del cliente para la vista "ICP del proyecto" de Pulso ABM:
// el general y el de cada industria (si el cliente trabaja por industria).
// Solo lectura; los cambios se proponen desde el portal (/portal/icp).
export type ClientIcp = { industry: string | null; form: IcpFormData };

export async function loadClientIcps(clientId: string): Promise<ClientIcp[]> {
  const db = supabaseAdmin();
  const industries = await listClientIndustries(db, clientId);
  const out: ClientIcp[] = [];
  const general = await loadIcpContent(db, clientId, null);
  if (general.trim()) out.push({ industry: null, form: deserializeIcpForm(general) });
  for (const ind of industries) {
    const text = await loadIcpContent(db, clientId, ind.id);
    if (text.trim()) out.push({ industry: ind.name, form: deserializeIcpForm(text) });
  }
  return out;
}

// Link de feedback de reuniones del cliente (/feedback-cliente/<token>)
export async function clientFeedbackToken(clientId: string): Promise<string | null> {
  const { data } = await supabaseAdmin().from("clients").select("feedback_token").eq("id", clientId).maybeSingle();
  return (data?.feedback_token as string | null | undefined) ?? null;
}
