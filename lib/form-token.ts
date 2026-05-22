import crypto from "crypto";

const SECRET = process.env.FORM_TOKEN_SECRET ?? "bullseye-forms-2026";

// Token determinístico basado en HMAC-SHA256 del client_id.
// No necesita tabla de base de datos — el token es siempre el mismo para el mismo cliente.
export function clientIdToToken(clientId: string): string {
  const sig = crypto
    .createHmac("sha256", SECRET)
    .update(clientId)
    .digest("hex")
    .slice(0, 32);
  return Buffer.from(`${clientId}.${sig}`).toString("base64url");
}

export function tokenToClientId(token: string): string | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf-8");
    const dot = decoded.lastIndexOf(".");
    if (dot === -1) return null;
    const clientId = decoded.slice(0, dot);
    const sig      = decoded.slice(dot + 1);
    const expected = crypto
      .createHmac("sha256", SECRET)
      .update(clientId)
      .digest("hex")
      .slice(0, 32);
    return sig === expected ? clientId : null;
  } catch {
    return null;
  }
}
