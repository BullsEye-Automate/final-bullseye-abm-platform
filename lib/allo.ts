const ALLO_API = "https://api.withallo.com";

function alloHeaders() {
  const key = process.env.ALLO_API_KEY;
  if (!key) {
    throw new Error("ALLO_API_KEY no está configurada (Vercel / .env.local)");
  }
  // La API de Allo espera la key cruda en Authorization, sin prefijo "Bearer".
  return {
    Authorization: key,
    "Content-Type": "application/json",
  };
}

export type AlloNumber = {
  number: string;
  name: string | null;
  country: string | null;
};

// Lista todos los números de Allo contratados por el workspace de BullsEye.
// Excluye Sender IDs / entradas sin número real (ej. el primer registro de
// /v2/api/numbers, que es un placeholder sin campo "number").
export async function listAlloNumbers(): Promise<AlloNumber[]> {
  const res = await fetch(`${ALLO_API}/v2/api/numbers`, {
    headers: alloHeaders(),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Allo API error (${res.status}): ${await res.text().catch(() => "")}`);
  }
  const d = await res.json();
  const items: any[] = d?.data ?? [];
  return items
    .filter((n) => typeof n.number === "string" && n.number.length > 0)
    .map((n) => ({
      number: n.number as string,
      name: (n.name as string) ?? null,
      country: (n.country as string) ?? null,
    }));
}
