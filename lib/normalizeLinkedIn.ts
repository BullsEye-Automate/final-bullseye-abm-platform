/**
 * Normaliza una LinkedIn URL al formato canónico https://linkedin.com/...
 * Elimina prefijos de país (cl., es., mx., co., ar., etc.), www., query params y slash final.
 */
export function normalizeLinkedInUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url
    .replace(/https?:\/\//, "")
    .replace(/^[a-z]{2,3}\.linkedin\.com/, "linkedin.com")
    .replace(/^www\.linkedin\.com/, "linkedin.com")
    .replace(/^/, "https://linkedin.com/")
    .replace("https://linkedin.com/https://linkedin.com/", "https://linkedin.com/")
    .replace("https://linkedin.com/linkedin.com/", "https://linkedin.com/")
    .split("?")[0]
    .replace(/\/$/, "");
}
