export interface MeetingListItem {
  id: string;
  ejecutivo: string | null;
  contraparte: string | null;
  empresa_contraparte: string | null;
  start_time: string | null;
  status: "scheduled" | "captured" | "analyzed";
}

function backendUrl(): string {
  return process.env.PEITHO_BACKEND_URL ?? "http://localhost:3001";
}

// Server-side fetch (Server Components) — nunca corre en el navegador, así que
// no hace falta configurar CORS en peitho-backend para esto.
export async function fetchMeetings(scope: "upcoming" | "past"): Promise<MeetingListItem[]> {
  const res = await fetch(`${backendUrl()}/meetings?scope=${scope}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`peitho-backend respondió ${res.status} en /meetings?scope=${scope}`);
  }
  return res.json();
}
