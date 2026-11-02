"use client";

// Editor de destinatarios de un correo automático del portal (chips + campo
// para agregar). Guarda en /api/mail-recipients (lib/mailRecipients.ts).
import { useEffect, useState } from "react";
import { IconX, IconPlus, IconLoader2, IconCheck } from "@tabler/icons-react";

type Key = "phone_health" | "reporte_sdr" | "feriados";
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

export default function MailRecipientsEditor({ reportKey, label = "Enviar a" }: { reportKey: Key; label?: string }) {
  const [emails, setEmails] = useState<string[] | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/mail-recipients")
      .then((r) => r.json())
      .then((j) => setEmails(j?.[reportKey] ?? []))
      .catch(() => setMsg({ ok: false, text: "No se pudieron cargar los destinatarios" }));
  }, [reportKey]);

  async function save(next: string[]) {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/mail-recipients", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: reportKey, emails: next }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "No se pudo guardar");
      setEmails(j.emails);
      setMsg({ ok: true, text: "Guardado" });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  function add() {
    const e = draft.trim().toLowerCase();
    if (!EMAIL_RE.test(e)) {
      setMsg({ ok: false, text: "Escribe un correo válido" });
      return;
    }
    if (emails?.includes(e)) {
      setDraft("");
      return;
    }
    setDraft("");
    save([...(emails ?? []), e]);
  }

  function remove(e: string) {
    if (!emails) return;
    if (emails.length === 1) {
      setMsg({ ok: false, text: "Debe quedar al menos un destinatario" });
      return;
    }
    save(emails.filter((x) => x !== e));
  }

  return (
    <div className="flex items-center gap-2 flex-wrap text-sm">
      <span className="text-ink-muted">{label}:</span>
      {emails === null && <IconLoader2 size={14} className="animate-spin text-ink-muted" />}
      {emails?.map((e) => (
        <span key={e} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md bg-black/[0.05] text-xs">
          {e}
          <button onClick={() => remove(e)} disabled={saving} aria-label={`Quitar ${e}`} className="p-0.5 rounded hover:bg-black/10">
            <IconX size={12} />
          </button>
        </span>
      ))}
      {emails !== null && (
        <span className="inline-flex items-center gap-1">
          <input
            value={draft}
            onChange={(ev) => {
              setDraft(ev.target.value);
              setMsg(null);
            }}
            onKeyDown={(ev) => ev.key === "Enter" && add()}
            placeholder="nombre@bullseye-abm.com"
            className="h-7 px-2 text-xs border rounded-md w-52"
          />
          <button
            onClick={add}
            disabled={saving || !draft.trim()}
            className="inline-flex items-center gap-1 h-7 px-2 text-xs border rounded-md hover:bg-black/5 disabled:opacity-50"
          >
            {saving ? <IconLoader2 size={12} className="animate-spin" /> : <IconPlus size={12} />} Agregar
          </button>
        </span>
      )}
      {msg && (
        <span className={`text-xs inline-flex items-center gap-1 ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>
          {msg.ok && <IconCheck size={12} />}
          {msg.text}
        </span>
      )}
    </div>
  );
}
