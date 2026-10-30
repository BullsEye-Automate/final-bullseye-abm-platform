// Badge de puntaje 1-10 (desempeño del vendedor, fit empresa/contacto) —
// extraído de MeetingsTable.tsx (30-09-2026) para reusar el mismo esquema de
// color en PanelDrilldownModal, en vez de duplicar los umbrales dos veces.
export default function ScoreBadge({ puntaje }: { puntaje: number | null | undefined }) {
  if (puntaje == null) return <span className="text-gray-300">—</span>;
  const [bg, color] =
    puntaje >= 8 ? ["#E6F6EE", "#1F8A5C"] : puntaje >= 5 ? ["#FBF1DF", "#B4740E"] : ["#FBE7E4", "#C0392B"];
  return (
    <span className="text-xs font-bold px-2.5 py-0.5 rounded-lg whitespace-nowrap" style={{ background: bg, color }}>
      {puntaje}/10
    </span>
  );
}
