import { readDoc, readDocs } from "./store";

// Identidad de las personas dentro del Centro de prospección.
// En el artifact cada persona tenía un id de claude.ai ("u_…") y la
// colección `vinculos` unía ese id con su correo. Los registros antiguos
// guardan ese id en el campo `por`; para que sigan atribuyéndose a la
// misma persona, quien ya tenía id de claude.ai lo conserva, y quien
// entra por primera vez usa su correo como id.

const PALETTE = ["#7F77DD", "#14A39A", "#E0457B", "#2F80ED", "#F08A3E", "#1F9D74", "#3D2878", "#D99A1E"];

function colorFor(key: string): string {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export async function resolveMyId(email: string): Promise<string> {
  const links = await readDocs(["vinculos"]);
  const hit = links.find((r) => String(r.data.email ?? "").toLowerCase() === email);
  return hit ? hit.doc_id : email;
}

function titleFromEmail(email: string): string {
  const user = email.split("@")[0] ?? email;
  return user.charAt(0).toUpperCase() + user.slice(1);
}

// Nombre y color de cada id (id de claude.ai o correo). Nombres desde
// config/equipo (miembros) y config/perfiles (nombres migrados del artifact).
export async function profilesFor(ids: string[]): Promise<Record<string, { name: string; color: string }>> {
  const [links, equipo, perfiles] = await Promise.all([
    readDocs(["vinculos"]),
    readDoc("config", "equipo"),
    readDoc("config", "perfiles"),
  ]);
  const emailOf = new Map(links.map((r) => [r.doc_id, String(r.data.email ?? "").toLowerCase()]));
  const nameByEmail = new Map<string, string>();
  const miembros = Array.isArray(equipo?.data.miembros) ? (equipo!.data.miembros as { email?: string; nombre?: string }[]) : [];
  for (const m of miembros) if (m.email && m.nombre) nameByEmail.set(m.email.toLowerCase(), m.nombre);
  const migrated = (perfiles?.data.personas ?? {}) as Record<string, { name?: string; color?: string }>;

  const out: Record<string, { name: string; color: string }> = {};
  for (const id of ids.slice(0, 200)) {
    const email = id.includes("@") ? id.toLowerCase() : emailOf.get(id) ?? "";
    const name = (email && nameByEmail.get(email)) || migrated[id]?.name || (email ? titleFromEmail(email) : "");
    out[id] = { name, color: migrated[id]?.color || colorFor(email || id) };
  }
  return out;
}
