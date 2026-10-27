"use client";

import { useState, useRef, useEffect } from "react";
import {
  IconSend, IconCopy, IconCheck, IconSparkles, IconRefresh,
  IconChevronDown, IconPhoto, IconX, IconSearch, IconPhone,
  IconArrowLeft,
} from "@tabler/icons-react";

type EmailType = "cold" | "no_contact" | "post_call" | "info" | "referral" | "meeting" | "meeting_brief";
type Channel   = "email" | "whatsapp" | "linkedin";
type Message   = { role: "user" | "assistant"; content: string; imagePreview?: string; channel?: Channel };

const MSG_TYPE_LABELS: Record<EmailType, string> = {
  cold:          "Primer contacto",
  no_contact:    "Sin contacto telefónico",
  post_call:     "Post-llamada",
  info:          "Más información",
  referral:      "Derivación / Referido",
  meeting:       "Confirmación de reunión",
  meeting_brief: "Previa de reunión (briefing)",
};

const MSG_TYPE_DESCRIPTIONS: Record<EmailType, string> = {
  cold:          "Sin conversación previa",
  no_contact:    "SDR intentó llamar, no contestó",
  post_call:     "Tras llamada conectada",
  info:          "El prospecto pidió más información",
  referral:      "Un conocido los refirió",
  meeting:       "Reunión ya agendada",
  meeting_brief: "Documento interno pre-reunión",
};

const CHANNEL_LABELS: Record<Channel, string> = {
  email: "Email", whatsapp: "WhatsApp", linkedin: "LinkedIn",
};

const LATAM_COUNTRIES = [
  { code: "AR", name: "Argentina" }, { code: "BO", name: "Bolivia" },
  { code: "BR", name: "Brasil" }, { code: "CL", name: "Chile" },
  { code: "CO", name: "Colombia" }, { code: "CR", name: "Costa Rica" },
  { code: "CU", name: "Cuba" }, { code: "DO", name: "República Dominicana" },
  { code: "EC", name: "Ecuador" }, { code: "SV", name: "El Salvador" },
  { code: "GT", name: "Guatemala" }, { code: "HN", name: "Honduras" },
  { code: "MX", name: "México" }, { code: "NI", name: "Nicaragua" },
  { code: "PA", name: "Panamá" }, { code: "PY", name: "Paraguay" },
  { code: "PE", name: "Perú" }, { code: "UY", name: "Uruguay" },
  { code: "VE", name: "Venezuela" },
];

type HSContact = {
  id: string; firstname: string; lastname: string; email: string;
  jobtitle: string; phone: string; estado_contacto: string;
  sdr_asignado: string; associatedcompanyid: string;
  num_contacted: string; last_contacted: string;
};

type AlloCall = {
  id: string; date: string; direction: string; duration: number;
  result: string | null; summary: string | null; user: string | null;
};

type Client  = { id: string; name: string };
type Segment = {
  id: string; name: string;
  message_focus: string | null; style_tone: string | null;
  style_rules: string | null; style_avoid: string | null; style_email_length: string | null;
};

function parseEmail(text: string): { subject: string; body: string } | null {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch {}
  return null;
}

function fmtDuration(s: number): string {
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("es-CL", { day: "numeric", month: "short", year: "numeric" });
  } catch { return iso; }
}

function InboxPreview({ subject, body, channel }: { subject: string; body: string; channel: string }) {
  if (channel === "email") return (
    <div className="rounded-xl overflow-hidden text-left" style={{ fontFamily: "Arial,sans-serif", background: "#fff", border: "1px solid #e0ddd8" }}>
      <div style={{ background: "#f6f5f0", borderBottom: "1px solid #e0ddd8", padding: "10px 16px", display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 22, height: 22, borderRadius: 5, background: "linear-gradient(135deg,#4285f4,#34a853)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 11, fontWeight: 700 }}>G</div>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#1f1f1f" }}>Gmail</span>
      </div>
      <div style={{ padding: "20px 20px 24px" }}>
        {subject && <div style={{ fontSize: 18, fontWeight: 700, color: "#202124", marginBottom: 14 }}>{subject}</div>}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 16, paddingBottom: 14, borderBottom: "1px solid #e8eaed" }}>
          <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#251762", display: "flex", alignItems: "center", justifyContent: "center", color: "#62E0D8", fontWeight: 700, fontSize: 13 }}>S</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>SDR BullsEye</div>
            <div style={{ fontSize: 11, color: "#5f6368" }}>Para: contacto@empresa.cl</div>
          </div>
          <div style={{ fontSize: 11, color: "#5f6368" }}>Hoy</div>
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.65, color: "#202124", whiteSpace: "pre-line" }}>{body}</div>
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid #e8eaed", fontSize: 12, color: "#5f6368" }}>
          <strong style={{ color: "#202124" }}>Tu nombre</strong><br />SDR · BullsEye
        </div>
      </div>
    </div>
  );

  if (channel === "linkedin") {
    const ff = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";
    return (
      <div style={{ fontFamily: ff, background: "#f3f2ef", borderRadius: 8, overflow: "hidden" }}>
        <div style={{ background: "#fff", borderBottom: "1px solid #e0ddd8", padding: "8px 14px", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: "Georgia,serif", fontWeight: 900, fontSize: 20, color: "#0a66c2", letterSpacing: -1 }}>in</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
            {[["🏠","Inicio"],["👥","Mi red"],["💬","Mensajes"],["🔔","Notif."]].map(([icon, label], i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column" as const, alignItems: "center", padding: "2px 10px", fontSize: 10, color: i === 2 ? "rgba(0,0,0,0.9)" : "rgba(0,0,0,0.55)", borderBottom: i === 2 ? "2px solid rgba(0,0,0,0.9)" : "2px solid transparent" }}>
                <span style={{ fontSize: 16 }}>{icon}</span>{label}
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", height: 380 }}>
          <div style={{ width: 200, borderRight: "1px solid #e0ddd8", background: "#fff", display: "flex", flexDirection: "column" as const }}>
            <div style={{ padding: "10px 10px 6px", borderBottom: "1px solid #e0ddd8" }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>Buzón</span>
            </div>
            <div style={{ flex: 1, overflowY: "auto" as const }}>
              <div style={{ display: "flex", gap: 8, padding: "8px 10px", background: "#eef3f8", borderLeft: "3px solid #057642" }}>
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#251762", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="#62E0D8" strokeWidth="2.2"/><circle cx="12" cy="12" r="4.5" stroke="#62E0D8" strokeWidth="2.2"/><circle cx="12" cy="12" r="1.8" fill="#62E0D8"/></svg>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>Contacto</div>
                  <div style={{ fontSize: 11, color: "rgba(0,0,0,0.5)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>Tú: {body.slice(0, 25)}…</div>
                </div>
              </div>
              {[["S","#b0b3b8","Sebastián D."],["GF","#0a66c2","Ghislaine F."]].map(([init, bg, name]) => (
                <div key={name} style={{ display: "flex", gap: 8, padding: "8px 10px", borderBottom: "1px solid #f3f2ef" }}>
                  <div style={{ width: 36, height: 36, borderRadius: "50%", background: bg, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: 12 }}>{init}</div>
                  <div style={{ flex: 1 }}><div style={{ fontSize: 12, fontWeight: 600 }}>{name}</div></div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column" as const }}>
            <div style={{ background: "#fff", borderBottom: "1px solid #e0ddd8", padding: "10px 12px" }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Contacto</div>
              <div style={{ fontSize: 11, color: "rgba(0,0,0,0.55)" }}>Cargo · Empresa</div>
            </div>
            <div style={{ flex: 1, background: "#f3f2ef", padding: "12px" }}>
              <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 8, padding: "12px 14px" }}>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <div style={{ width: 34, height: 34, borderRadius: "50%", background: "#251762", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="#62E0D8" strokeWidth="2.2"/><circle cx="12" cy="12" r="4.5" stroke="#62E0D8" strokeWidth="2.2"/><circle cx="12" cy="12" r="1.8" fill="#62E0D8"/></svg>
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>Tu nombre <span style={{ fontWeight: 400, color: "rgba(0,0,0,0.5)", fontSize: 11 }}>· ahora</span></div>
                    <div style={{ fontSize: 11, color: "rgba(0,0,0,0.55)" }}>SDR · BullsEye ABM</div>
                  </div>
                </div>
                <div style={{ fontSize: 13.5, lineHeight: 1.65, color: "rgba(0,0,0,0.85)", whiteSpace: "pre-line" as const }}>{body}</div>
              </div>
            </div>
            <div style={{ background: "#fff", borderTop: "1px solid #e0ddd8", padding: "8px 12px" }}>
              <div style={{ border: "1px solid rgba(0,0,0,0.25)", borderRadius: 4, padding: "6px 10px", fontSize: 12, color: "rgba(0,0,0,0.35)" }}>Escribe un mensaje...</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "#111b21" }}>
      <div style={{ background: "#202c33", borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "8px 14px", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#2a3942", display: "flex", alignItems: "center", justifyContent: "center", color: "#8696a0", fontWeight: 700 }}>C</div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#e9edef" }}>Contacto</div>
          <div style={{ fontSize: 11, color: "#8696a0" }}>en línea</div>
        </div>
      </div>
      <div style={{ background: "#0b141a", padding: "14px 12px 20px", display: "flex", justifyContent: "flex-end" }}>
        <div style={{ background: "#005c4b", color: "#e9edef", borderRadius: "8px 0 8px 8px", padding: "8px 12px 22px", fontSize: 13.5, lineHeight: 1.55, maxWidth: "88%", whiteSpace: "pre-line" as const, position: "relative" as const }}>
          {body}
          <span style={{ position: "absolute" as const, bottom: 5, right: 10, fontSize: 11, color: "rgba(233,237,239,0.6)" }}>✓✓</span>
        </div>
      </div>
    </div>
  );
}

function EmailCard({ subject, body, showSubject = true, channel = "email" }: { subject: string; body: string; showSubject?: boolean; channel?: string }) {
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState(false);

  async function copy() {
    const text = showSubject && subject ? `Asunto: ${subject}\n\n${body}` : body;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const channelLabel = channel === "email" ? "Email" : channel === "linkedin" ? "LinkedIn" : "WhatsApp";

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "#fff", border: "1px solid #e2e0f0" }}>
      {showSubject && subject && (
        <div className="px-5 py-3.5" style={{ borderBottom: "1px solid #ece9f8" }}>
          <p className="text-[10px] uppercase tracking-widest mb-1 font-semibold" style={{ color: "#8b86b8" }}>Asunto</p>
          <p className="text-sm font-semibold" style={{ color: "#1a1535" }}>{subject}</p>
        </div>
      )}
      <div className="px-5 py-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: "#8b86b8" }}>Mensaje</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setPreview(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[12px] font-medium"
              style={{ background: preview ? "rgba(98,224,216,0.12)" : "#f3f1fc", color: preview ? "#1a9e98" : "#6b66a3", border: `1px solid ${preview ? "rgba(98,224,216,0.4)" : "#e2e0f0"}` }}>
              {preview ? "Ocultar" : `Ver como ${channelLabel}`}
            </button>
            <button onClick={copy}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[12px] font-medium"
              style={{ background: "#251762", color: "#62E0D8" }}>
              {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
              {copied ? "Copiado" : "Copiar"}
            </button>
          </div>
        </div>
        <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: "#2d2950" }}>{body}</p>
      </div>
      {preview && (
        <div className="px-4 pb-4">
          <InboxPreview subject={subject} body={body} channel={channel} />
        </div>
      )}
    </div>
  );
}

function Bubble({ msg, channel }: { msg: Message; channel: string }) {
  const isUser = msg.role === "user";
  const effectiveChannel = msg.channel ?? channel;
  const parsed = !isUser ? parseEmail(msg.content) : null;

  return (
    <div className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"} mb-5`}>
      {!isUser && (
        <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center mt-0.5" style={{ background: "#ede9fb" }}>
          <IconSparkles size={15} style={{ color: "#251762" }} />
        </div>
      )}
      <div className="max-w-[85%] flex flex-col gap-2">
        {msg.imagePreview && (
          <img src={msg.imagePreview} alt="Adjunto" className="rounded-xl max-w-full" style={{ maxHeight: 220, objectFit: "contain" }} />
        )}
        {parsed ? (
          <EmailCard subject={parsed.subject ?? ""} body={parsed.body ?? ""} showSubject={effectiveChannel === "email"} channel={effectiveChannel} />
        ) : (
          <div className="rounded-2xl px-4 py-3 text-sm leading-relaxed"
            style={isUser ? { background: "#251762", color: "rgba(255,255,255,0.92)" } : { background: "#fff", color: "#2d2950", border: "1px solid #e2e0f0" }}>
            {msg.content}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ChatV2Page() {
  const [clients, setClients]           = useState<Client[]>([]);
  const [clientId, setClientId]         = useState("");
  const [clientOpen, setClientOpen]     = useState(false);
  const [segments, setSegments]         = useState<Segment[]>([]);
  const [segmentId, setSegmentId]       = useState("");
  const [segmentOpen, setSegmentOpen]   = useState(false);

  const [contactQuery, setContactQuery]         = useState("");
  const [contactResults, setContactResults]     = useState<HSContact[]>([]);
  const [contactSearching, setContactSearching] = useState(false);
  const [selectedContact, setSelectedContact]   = useState<HSContact | null>(null);
  const [contactDropOpen, setContactDropOpen]   = useState(false);

  const [alloCalls, setAlloCalls]         = useState<AlloCall[]>([]);
  const [alloLoading, setAlloLoading]     = useState(false);
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);

  const [emailType, setEmailType]           = useState<EmailType>("cold");
  const [typeOpen, setTypeOpen]             = useState(false);
  const [channel, setChannel]               = useState<Channel>("email");
  const [recipientName, setRecipientName]   = useState("");
  const [recipientCompany, setRecipientCompany] = useState("");
  const [recipientTitle, setTitle]          = useState("");
  const [referrerName, setReferrer]         = useState("");
  const [meetingDate, setMeetingDate]       = useState("");
  const [meetingCountry, setMeetingCountry] = useState("CL");
  const [holidayWarning, setHolidayWarning] = useState<string | null>(null);
  const [contextNotes, setNotes]            = useState("");

  const [messages, setMessages]       = useState<Message[]>([]);
  const [input, setInput]             = useState("");
  const [pendingImage, setPendingImage] = useState<{ base64: string; mediaType: string; preview: string } | null>(null);
  const [loading, setLoading]         = useState(false);
  const bottomRef   = useRef<HTMLDivElement>(null);
  const fileRef     = useRef<HTMLInputElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch("/api/clients").then(r => r.json()).then(j => setClients(j.clients ?? [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!clientId) { setSegments([]); setSegmentId(""); return; }
    fetch(`/api/training/segments?client_id=${clientId}`)
      .then(r => r.json()).then(j => setSegments(j.segments ?? [])).catch(() => {});
  }, [clientId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    setHolidayWarning(null);
    if (!meetingDate || !["meeting","meeting_brief"].includes(emailType)) return;
    const d = new Date(meetingDate);
    if (isNaN(d.getTime())) return;
    const dow = d.getDay();
    if (dow === 0 || dow === 6) { setHolidayWarning(dow === 6 ? "Sábado" : "Domingo"); return; }
    const dateKey = meetingDate.slice(0, 10);
    fetch(`https://date.nager.at/api/v3/PublicHolidays/${d.getFullYear()}/${meetingCountry}`)
      .then(r => r.ok ? r.json() : [])
      .then((h: { date: string; localName: string }[]) => {
        const m = h.find(x => x.date === dateKey);
        setHolidayWarning(m ? m.localName : null);
      })
      .catch(() => {});
  }, [meetingDate, meetingCountry, emailType]);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!contactQuery || contactQuery.length < 2) { setContactResults([]); setContactDropOpen(false); return; }
    searchTimer.current = setTimeout(async () => {
      setContactSearching(true);
      try {
        const r = await fetch(`/api/hubspot/contact-search?q=${encodeURIComponent(contactQuery)}`);
        const j = await r.json();
        setContactResults(j.contacts ?? []);
        setContactDropOpen(true);
      } catch { setContactResults([]); }
      finally { setContactSearching(false); }
    }, 300);
  }, [contactQuery]);

  useEffect(() => {
    setAlloCalls([]);
    setSelectedCallId(null);
    if (!selectedContact?.phone) return;
    setAlloLoading(true);
    fetch(`/api/allo/contact-calls?phone=${encodeURIComponent(selectedContact.phone)}`)
      .then(r => r.json()).then(j => setAlloCalls(j.calls ?? [])).catch(() => {})
      .finally(() => setAlloLoading(false));
  }, [selectedContact?.phone]);

  function selectContact(c: HSContact) {
    setSelectedContact(c);
    setContactQuery(`${c.firstname} ${c.lastname}`.trim());
    setContactDropOpen(false);
    setRecipientName(`${c.firstname} ${c.lastname}`.trim());
    if (c.jobtitle) setTitle(c.jobtitle);
  }

  function clearContact() {
    setSelectedContact(null);
    setContactQuery("");
    setRecipientName("");
    setTitle("");
    setAlloCalls([]);
    setSelectedCallId(null);
  }

  async function send(userContent: string, isFirst = false, image?: typeof pendingImage) {
    setLoading(true);
    const newMsg: Message = { role: "user", content: userContent, imagePreview: image?.preview };
    const updated = [...messages, newMsg];
    setMessages(updated);
    setPendingImage(null);

    try {
      const lower = userContent.toLowerCase();
      let effectiveChannel = channel;
      if (lower.includes("linkedin")) effectiveChannel = "linkedin";
      else if (lower.includes("whatsapp")) effectiveChannel = "whatsapp";
      else if (lower.includes("email") || lower.includes("correo")) effectiveChannel = "email";

      const selectedCall = alloCalls.find(c => c.id === selectedCallId);

      const res = await fetch("/api/agente-contenido-v2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          messages: updated.map(m => ({ role: m.role, content: m.content })),
          emailType, channel: effectiveChannel,
          segmentId: segmentId || undefined,
          recipientName, recipientCompany, recipientTitle,
          referrerName:   emailType === "referral" ? referrerName : undefined,
          meetingDate:    ["meeting","meeting_brief"].includes(emailType) ? meetingDate : undefined,
          meetingCountry: ["meeting","meeting_brief"].includes(emailType) ? meetingCountry : undefined,
          contextNotes,
          hubspotContactId: selectedContact?.id,
          alloCallSummary: selectedCall?.summary ?? undefined,
          save: isFirst,
          image: image ? { base64: image.base64, mediaType: image.mediaType } : undefined,
        }),
      });

      const data = await res.json();
      setMessages(prev => [...prev, { role: "assistant", content: data.message ?? data.error ?? "Error al generar.", channel: effectiveChannel }]);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Error de conexión. Intenta de nuevo." }]);
    } finally {
      setLoading(false);
    }
  }

  function handleImagePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const [header, base64] = dataUrl.split(",");
      const mediaType = header.match(/:(.*?);/)?.[1] ?? "image/png";
      setPendingImage({ base64, mediaType, preview: dataUrl });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  async function handleStart(e: React.FormEvent) {
    e.preventDefault();
    if (!clientId) return;
    setMessages([]);
    await send("Genera el mensaje", true, pendingImage);
  }

  async function handleChat(e: React.FormEvent) {
    e.preventDefault();
    if ((!input.trim() && !pendingImage) || loading) return;
    const text = input.trim() || "Genera una respuesta.";
    setInput("");
    await send(text, false, pendingImage);
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#f4f2fb" }}>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImagePick} />

      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-6 py-4"
        style={{ background: "#251762", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <div className="flex items-center gap-3">
          <a href="/chat" className="flex items-center gap-1.5 text-[11px] hover:opacity-70 mr-1"
            style={{ color: "rgba(255,255,255,0.4)" }}>
            <IconArrowLeft size={13} /> v1
          </a>
          <div className="text-[18px] font-bold tracking-tight leading-none">
            <span className="text-white">Bulls</span>
            <span style={{ color: "#62E0D8" }}>Eye</span>
          </div>
          <span className="text-[11px] px-2 py-0.5 rounded-full font-medium"
            style={{ background: "rgba(98,224,216,0.15)", color: "#62E0D8" }}>
            Agente V2
          </span>
          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
            style={{ background: "rgba(251,191,36,0.2)", color: "#fbbf24" }}>
            Beta interna
          </span>
        </div>
        {messages.length > 0 && (
          <button onClick={() => { setMessages([]); setInput(""); setPendingImage(null); }}
            className="flex items-center gap-1.5 text-[12px] hover:opacity-70"
            style={{ color: "rgba(255,255,255,0.55)" }}>
            <IconRefresh size={13} /> Limpiar
          </button>
        )}
      </div>

      <div className="flex-1 flex overflow-hidden" style={{ height: "calc(100vh - 57px)" }}>

        {/* Panel izquierdo */}
        <div className="shrink-0 flex flex-col overflow-y-auto"
          style={{ width: 380, background: "#fff", borderRight: "1px solid #e2e0f0" }}>
          <div className="px-5 py-5">
            <form onSubmit={handleStart} className="space-y-4">

              {/* Cliente */}
              <div className="relative">
                <label className="block text-[11px] uppercase tracking-widest font-semibold mb-2" style={{ color: "#9b97c0" }}>Cliente</label>
                <button type="button" onClick={() => setClientOpen(v => !v)}
                  className="w-full flex items-center justify-between rounded-xl px-4 py-2.5 text-sm text-left"
                  style={{ background: "#f4f2fb", border: "1px solid #e2e0f0", color: clientId ? "#1a1535" : "#b0acd4" }}>
                  <span>{clients.find(c => c.id === clientId)?.name ?? "Seleccionar cliente..."}</span>
                  <IconChevronDown size={14} style={{ color: "#b0acd4", transform: clientOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
                </button>
                {clientOpen && (
                  <div className="absolute left-0 right-0 top-full mt-1 rounded-xl overflow-y-auto z-20"
                    style={{ background: "#fff", border: "1px solid #e2e0f0", boxShadow: "0 8px 24px rgba(37,23,98,0.12)", maxHeight: 200 }}>
                    {clients.map(c => (
                      <button type="button" key={c.id} onClick={() => { setClientId(c.id); setClientOpen(false); }}
                        className="w-full text-left px-4 py-2.5 text-sm transition hover:bg-[#f4f2fb]"
                        style={{ color: clientId === c.id ? "#251762" : "#2d2950", fontWeight: clientId === c.id ? 600 : 400 }}>
                        {c.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Buscar contacto HubSpot */}
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-semibold mb-2" style={{ color: "#9b97c0" }}>
                  Contacto HubSpot <span style={{ fontWeight: 400 }}>(opcional)</span>
                </label>
                <div className="relative">
                  <IconSearch size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "#b0acd4" }} />
                  <input type="text" value={contactQuery}
                    onChange={e => { setContactQuery(e.target.value); if (selectedContact) clearContact(); }}
                    placeholder="Buscar por nombre, email..."
                    className="w-full rounded-xl pl-9 pr-9 py-2.5 text-sm outline-none"
                    style={{ background: "#f4f2fb", border: "1px solid #e2e0f0", color: "#1a1535" }} />
                  {contactSearching && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 animate-pulse text-[11px]" style={{ color: "#b0acd4" }}>...</span>
                  )}
                  {selectedContact && !contactSearching && (
                    <button type="button" onClick={clearContact} className="absolute right-3 top-1/2 -translate-y-1/2">
                      <IconX size={13} style={{ color: "#b0acd4" }} />
                    </button>
                  )}

                  {/* Dropdown */}
                  {contactDropOpen && contactResults.length > 0 && (
                    <div className="absolute left-0 right-0 top-full mt-1 rounded-xl overflow-hidden z-30"
                      style={{ background: "#fff", border: "1px solid #e2e0f0", boxShadow: "0 8px 24px rgba(37,23,98,0.12)", maxHeight: 220, overflowY: "auto" }}>
                      {contactResults.map(c => (
                        <button type="button" key={c.id} onClick={() => selectContact(c)}
                          className="w-full text-left px-4 py-2.5 transition hover:bg-[#f4f2fb]">
                          <div className="text-sm font-medium" style={{ color: "#1a1535" }}>
                            {c.firstname} {c.lastname}
                          </div>
                          <div className="text-[11px]" style={{ color: "#9b97c0" }}>
                            {[c.jobtitle, c.email].filter(Boolean).join(" · ")}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Tarjeta del contacto */}
                {selectedContact && (
                  <div className="mt-2 rounded-xl p-3" style={{ background: "#f4f2fb", border: "1px solid #e2e0f0" }}>
                    <div className="flex items-start gap-2.5">
                      <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-bold"
                        style={{ background: "#251762", color: "#62E0D8" }}>
                        {(selectedContact.firstname?.[0] ?? "?").toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold" style={{ color: "#1a1535" }}>
                          {selectedContact.firstname} {selectedContact.lastname}
                        </div>
                        {selectedContact.jobtitle && (
                          <div className="text-[11px]" style={{ color: "#6b66a3" }}>{selectedContact.jobtitle}</div>
                        )}
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {selectedContact.estado_contacto && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                              style={{ background: "rgba(98,224,216,0.15)", color: "#1a9e98" }}>
                              {selectedContact.estado_contacto}
                            </span>
                          )}
                          {selectedContact.phone && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-medium flex items-center gap-1"
                              style={{ background: "#ede9fb", color: "#6b66a3" }}>
                              <IconPhone size={9} /> {selectedContact.phone}
                            </span>
                          )}
                          {selectedContact.num_contacted && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                              style={{ background: "#ede9fb", color: "#6b66a3" }}>
                              {selectedContact.num_contacted} intentos
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Llamadas Allo */}
              {selectedContact && (
                <div>
                  <label className="block text-[11px] uppercase tracking-widest font-semibold mb-2" style={{ color: "#9b97c0" }}>
                    Llamadas recientes (Allo)
                  </label>
                  {alloLoading && <div className="text-[12px]" style={{ color: "#b0acd4" }}>Buscando llamadas...</div>}
                  {!alloLoading && !selectedContact.phone && <div className="text-[12px]" style={{ color: "#b0acd4" }}>Sin teléfono en HubSpot</div>}
                  {!alloLoading && selectedContact.phone && alloCalls.length === 0 && (
                    <div className="text-[12px]" style={{ color: "#b0acd4" }}>Sin llamadas en los últimos 90 días</div>
                  )}
                  {alloCalls.length > 0 && (
                    <div className="space-y-1.5">
                      {alloCalls.map(call => (
                        <button key={call.id} type="button"
                          onClick={() => setSelectedCallId(prev => prev === call.id ? null : call.id)}
                          className="w-full text-left rounded-xl px-3 py-2.5 transition"
                          style={{
                            background: selectedCallId === call.id ? "rgba(37,23,98,0.06)" : "#f4f2fb",
                            border: `1px solid ${selectedCallId === call.id ? "#9b97c0" : "#e2e0f0"}`,
                          }}>
                          <div className="flex items-center justify-between">
                            <span className="text-[12px] font-medium" style={{ color: "#1a1535" }}>{fmtDate(call.date)}</span>
                            <div className="flex items-center gap-2">
                              {call.result && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                                  style={{
                                    background: call.result === "ANSWERED" ? "rgba(16,185,129,0.1)" : "rgba(156,163,175,0.2)",
                                    color: call.result === "ANSWERED" ? "#059669" : "#6b7280",
                                  }}>
                                  {call.result === "ANSWERED" ? "Conectada" : call.result === "VOICEMAIL" ? "Buzón" : call.result}
                                </span>
                              )}
                              <span className="text-[11px]" style={{ color: "#9b97c0" }}>{fmtDuration(call.duration)}</span>
                            </div>
                          </div>
                          {call.user && <div className="text-[11px] mt-0.5" style={{ color: "#9b97c0" }}>{call.user}</div>}
                          {call.summary && (
                            <div className="text-[11px] mt-1 line-clamp-2" style={{ color: "#6b66a3" }}>{call.summary}</div>
                          )}
                        </button>
                      ))}
                      {selectedCallId && (
                        <div className="text-[10px] mt-1" style={{ color: "#9b97c0" }}>
                          ✓ Resumen de esta llamada incluido en el contexto
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Tipo de mensaje */}
              <div className="relative">
                <label className="block text-[11px] uppercase tracking-widest font-semibold mb-2" style={{ color: "#9b97c0" }}>Tipo de mensaje</label>
                <button type="button" onClick={() => setTypeOpen(v => !v)}
                  className="w-full flex items-center justify-between rounded-xl px-4 py-2.5 text-sm text-left"
                  style={{ background: "#f4f2fb", border: "1px solid #e2e0f0", color: "#1a1535" }}>
                  <span>{MSG_TYPE_LABELS[emailType]}</span>
                  <IconChevronDown size={14} style={{ color: "#b0acd4", transform: typeOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
                </button>
                {typeOpen && (
                  <div className="absolute left-0 right-0 top-full mt-1 rounded-xl overflow-hidden z-20"
                    style={{ background: "#fff", border: "1px solid #e2e0f0", boxShadow: "0 8px 24px rgba(37,23,98,0.12)" }}>
                    {(Object.entries(MSG_TYPE_LABELS) as [EmailType, string][]).map(([val, label]) => (
                      <button type="button" key={val}
                        onClick={() => { setEmailType(val); setTypeOpen(false); }}
                        className="w-full text-left px-4 py-2.5 transition hover:bg-[#f4f2fb]">
                        <div className="text-sm" style={{ color: emailType === val ? "#251762" : "#2d2950", fontWeight: emailType === val ? 600 : 400 }}>
                          {label}
                        </div>
                        <div className="text-[11px]" style={{ color: "#9b97c0" }}>{MSG_TYPE_DESCRIPTIONS[val]}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Canal (oculto para meeting_brief) */}
              {emailType !== "meeting_brief" && (
                <div>
                  <label className="block text-[11px] uppercase tracking-widest font-semibold mb-2" style={{ color: "#9b97c0" }}>Canal</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(Object.entries(CHANNEL_LABELS) as [Channel, string][]).map(([val, label]) => (
                      <button type="button" key={val} onClick={() => setChannel(val)}
                        className="py-2.5 rounded-xl text-sm font-medium transition"
                        style={{ background: channel === val ? "#251762" : "#f4f2fb", border: `1px solid ${channel === val ? "#251762" : "#e2e0f0"}`, color: channel === val ? "#62E0D8" : "#6b66a3" }}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Guía de estilo */}
              {segments.length > 0 && (
                <div className="relative">
                  <label className="block text-[11px] uppercase tracking-widest font-semibold mb-2" style={{ color: "#9b97c0" }}>
                    Guía de estilo <span style={{ fontWeight: 400 }}>(opcional)</span>
                  </label>
                  <button type="button" onClick={() => setSegmentOpen(v => !v)}
                    className="w-full flex items-center justify-between rounded-xl px-4 py-2.5 text-sm text-left"
                    style={{ background: "#f4f2fb", border: "1px solid #e2e0f0", color: segmentId ? "#1a1535" : "#b0acd4" }}>
                    <span>{segments.find(s => s.id === segmentId)?.name ?? "Sin segmentación específica"}</span>
                    <IconChevronDown size={14} style={{ color: "#b0acd4" }} />
                  </button>
                  {segmentOpen && (
                    <div className="absolute left-0 right-0 top-full mt-1 rounded-xl overflow-hidden z-20"
                      style={{ background: "#fff", border: "1px solid #e2e0f0", boxShadow: "0 8px 24px rgba(37,23,98,0.12)" }}>
                      <button type="button" onClick={() => { setSegmentId(""); setSegmentOpen(false); }}
                        className="w-full text-left px-4 py-2.5 text-sm transition hover:bg-[#f4f2fb]"
                        style={{ color: !segmentId ? "#251762" : "#9b97c0", fontWeight: !segmentId ? 600 : 400 }}>
                        Sin segmentación específica
                      </button>
                      {segments.map(s => (
                        <button type="button" key={s.id}
                          onClick={() => { setSegmentId(s.id); setSegmentOpen(false); }}
                          className="w-full text-left px-4 py-2.5 text-sm transition hover:bg-[#f4f2fb]"
                          style={{ color: segmentId === s.id ? "#251762" : "#2d2950", fontWeight: segmentId === s.id ? 600 : 400 }}>
                          {s.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Nombre y empresa */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] uppercase tracking-widest font-semibold mb-2" style={{ color: "#9b97c0" }}>Nombre</label>
                  <input type="text" value={recipientName} onChange={e => setRecipientName(e.target.value)}
                    placeholder="Ej: María González"
                    className="w-full rounded-xl px-4 py-2.5 text-sm outline-none"
                    style={{ background: "#f4f2fb", border: "1px solid #e2e0f0", color: "#1a1535" }} />
                </div>
                <div>
                  <label className="block text-[11px] uppercase tracking-widest font-semibold mb-2" style={{ color: "#9b97c0" }}>Empresa</label>
                  <input type="text" value={recipientCompany} onChange={e => setRecipientCompany(e.target.value)}
                    placeholder="Ej: Clínica Norte"
                    className="w-full rounded-xl px-4 py-2.5 text-sm outline-none"
                    style={{ background: "#f4f2fb", border: "1px solid #e2e0f0", color: "#1a1535" }} />
                </div>
              </div>

              {/* Cargo */}
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-semibold mb-2" style={{ color: "#9b97c0" }}>Cargo del destinatario</label>
                <input type="text" value={recipientTitle} onChange={e => setTitle(e.target.value)}
                  placeholder="Ej: Director de Operaciones"
                  className="w-full rounded-xl px-4 py-2.5 text-sm outline-none"
                  style={{ background: "#f4f2fb", border: "1px solid #e2e0f0", color: "#1a1535" }} />
              </div>

              {/* Derivación */}
              {emailType === "referral" && (
                <div>
                  <label className="block text-[11px] uppercase tracking-widest font-semibold mb-2" style={{ color: "#9b97c0" }}>¿Quién los derivó?</label>
                  <input type="text" value={referrerName} onChange={e => setReferrer(e.target.value)}
                    placeholder="Ej: Juan Pérez"
                    className="w-full rounded-xl px-4 py-2.5 text-sm outline-none"
                    style={{ background: "#f4f2fb", border: "1px solid #e2e0f0", color: "#1a1535" }} />
                </div>
              )}

              {/* Fecha reunión */}
              {["meeting","meeting_brief"].includes(emailType) && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-[11px] uppercase tracking-widest font-semibold mb-2" style={{ color: "#9b97c0" }}>País del destinatario</label>
                    <select value={meetingCountry} onChange={e => setMeetingCountry(e.target.value)}
                      className="w-full rounded-xl px-4 py-2.5 text-sm outline-none appearance-none"
                      style={{ background: "#f4f2fb", border: "1px solid #e2e0f0", color: "#1a1535" }}>
                      {LATAM_COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] uppercase tracking-widest font-semibold mb-2" style={{ color: "#9b97c0" }}>Fecha y hora</label>
                    <input type="datetime-local" value={meetingDate} onChange={e => setMeetingDate(e.target.value)}
                      className="w-full rounded-xl px-4 py-2.5 text-sm outline-none"
                      style={{ background: "#f4f2fb", border: `1px solid ${holidayWarning ? "#f59e0b" : "#e2e0f0"}`, color: meetingDate ? "#1a1535" : "#b0acd4" }} />
                    {holidayWarning && (
                      <div className="flex items-center gap-1.5 mt-2 px-3 py-2 rounded-lg text-xs font-medium"
                        style={{ background: "#fffbeb", border: "1px solid #fcd34d", color: "#92400e" }}>
                        ⚠️ {holidayWarning === "Sábado" || holidayWarning === "Domingo"
                          ? <>Esta fecha cae en <strong>{holidayWarning}</strong></>
                          : <>Esta fecha es feriado: <strong>{holidayWarning}</strong></>}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Contexto adicional */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[11px] uppercase tracking-widest font-semibold" style={{ color: "#9b97c0" }}>
                    Contexto adicional <span style={{ fontWeight: 400 }}>(opcional)</span>
                  </label>
                  <button type="button" onClick={() => fileRef.current?.click()}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px]"
                    style={{ background: pendingImage ? "rgba(37,23,98,0.08)" : "#f4f2fb", border: "1px solid #e2e0f0", color: pendingImage ? "#251762" : "#9b97c0" }}>
                    <IconPhoto size={13} />
                    {pendingImage ? "Imagen lista" : "Adjuntar"}
                  </button>
                </div>
                <textarea value={contextNotes} onChange={e => setNotes(e.target.value)}
                  placeholder="Algo relevante que el agente debería saber..."
                  rows={3} className="w-full rounded-xl px-4 py-2.5 text-sm outline-none resize-none"
                  style={{ background: "#f4f2fb", border: "1px solid #e2e0f0", color: "#1a1535" }} />
                {pendingImage && (
                  <div className="mt-2 relative inline-block">
                    <img src={pendingImage.preview} alt="Adjunto" className="rounded-xl" style={{ maxHeight: 100, maxWidth: "100%", objectFit: "contain", border: "1px solid #e2e0f0" }} />
                    <button type="button" onClick={() => setPendingImage(null)}
                      className="absolute -top-2 -right-2 w-5 h-5 rounded-full flex items-center justify-center"
                      style={{ background: "#fff", border: "1px solid #e2e0f0" }}>
                      <IconX size={11} style={{ color: "#9b97c0" }} />
                    </button>
                  </div>
                )}
              </div>

              <button type="submit" disabled={!clientId}
                className="w-full py-3 rounded-xl text-sm font-semibold transition hover:opacity-90 disabled:opacity-30 flex items-center justify-center gap-2"
                style={{ background: "#251762", color: "#62E0D8" }}>
                <IconSparkles size={15} />
                {messages.length > 0 ? "Regenerar" : "Generar mensaje"}
              </button>
            </form>
          </div>
        </div>

        {/* Panel derecho: chat */}
        <div className="flex-1 flex flex-col overflow-hidden" style={{ background: "#f4f2fb" }}>
          {messages.length === 0 && !loading ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
                style={{ background: "#ede9fb", border: "1px solid #e2e0f0" }}>
                <IconSparkles size={22} style={{ color: "#251762", opacity: 0.5 }} />
              </div>
              <p className="text-sm text-center" style={{ color: "#b0acd4", maxWidth: 300 }}>
                Busca un contacto en HubSpot para hiperpersonalizar el mensaje, elige el tipo y canal, y haz clic en{" "}
                <strong style={{ color: "#6b66a3" }}>Generar mensaje</strong>.
              </p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto px-6 py-6">
              {messages.map((msg, i) => <Bubble key={i} msg={msg} channel={channel} />)}
              {loading && (
                <div className="flex gap-3 mb-5">
                  <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "#ede9fb" }}>
                    <IconSparkles size={15} style={{ color: "#251762" }} />
                  </div>
                  <div className="rounded-2xl px-4 py-3 text-sm" style={{ background: "#fff", border: "1px solid #e2e0f0" }}>
                    <span className="animate-pulse" style={{ color: "#b0acd4" }}>Escribiendo...</span>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}

          {(messages.length > 0 || loading) && (
            <div className="shrink-0 px-6 pb-6 pt-3" style={{ borderTop: "1px solid #e2e0f0", background: "#fff" }}>
              {pendingImage && (
                <div className="mb-2 relative inline-block">
                  <img src={pendingImage.preview} alt="A enviar" className="rounded-xl"
                    style={{ maxHeight: 100, maxWidth: 200, objectFit: "contain", border: "1px solid #e2e0f0" }} />
                  <button type="button" onClick={() => setPendingImage(null)}
                    className="absolute -top-2 -right-2 w-5 h-5 rounded-full flex items-center justify-center"
                    style={{ background: "#fff", border: "1px solid #e2e0f0" }}>
                    <IconX size={11} style={{ color: "#9b97c0" }} />
                  </button>
                </div>
              )}
              <form onSubmit={handleChat} className="flex gap-2">
                <button type="button" onClick={() => fileRef.current?.click()} disabled={loading}
                  className="shrink-0 px-3 rounded-xl hover:opacity-80 disabled:opacity-30"
                  style={{ background: "#f4f2fb", border: "1px solid #e2e0f0", color: pendingImage ? "#251762" : "#b0acd4" }}>
                  <IconPhoto size={17} />
                </button>
                <input type="text" value={input} onChange={e => setInput(e.target.value)}
                  placeholder="Pide ajustes, variaciones, otro tono..."
                  disabled={loading}
                  className="flex-1 rounded-xl px-4 py-2.5 text-sm outline-none"
                  style={{ background: "#f4f2fb", border: "1px solid #e2e0f0", color: "#1a1535" }} />
                <button type="submit" disabled={(!input.trim() && !pendingImage) || loading}
                  className="px-4 rounded-xl hover:opacity-80 disabled:opacity-30"
                  style={{ background: "#251762", color: "#62E0D8" }}>
                  <IconSend size={16} />
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
