"use client";

import { useState, useRef, useEffect } from "react";
import {
  IconSend, IconCopy, IconCheck, IconSparkles, IconRefresh,
  IconChevronDown, IconPhoto, IconX,
} from "@tabler/icons-react";

type EmailType = "info" | "referral" | "cold" | "meeting";
type Channel   = "email" | "whatsapp" | "linkedin";
type Message   = { role: "user" | "assistant"; content: string; imagePreview?: string; channel?: Channel };

const MSG_TYPE_LABELS: Record<EmailType, string> = {
  info:     "Más información",
  referral: "Derivación / Referido",
  cold:     "Primer contacto",
  meeting:  "Confirmación de reunión",
};

const CHANNEL_LABELS: Record<Channel, string> = {
  email:    "Email",
  whatsapp: "WhatsApp",
  linkedin: "LinkedIn",
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

function InboxPreview({ subject, body, channel }: { subject: string; body: string; channel: string }) {
  if (channel === "email") return (
    <div className="rounded-xl overflow-hidden text-left" style={{ fontFamily: "Arial, sans-serif", background: "#fff", border: "1px solid #e0ddd8" }}>
      <div style={{ background: "#f6f5f0", borderBottom: "1px solid #e0ddd8", padding: "10px 16px", display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 22, height: 22, borderRadius: 5, background: "linear-gradient(135deg,#4285f4,#34a853)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>G</div>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#1f1f1f" }}>Gmail</span>
      </div>
      <div style={{ padding: "20px 20px 24px", background: "#fff" }}>
        {subject && <div style={{ fontSize: 18, fontWeight: 700, color: "#202124", marginBottom: 14, lineHeight: 1.3 }}>{subject}</div>}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 16, paddingBottom: 14, borderBottom: "1px solid #e8eaed" }}>
          <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#251762", display: "flex", alignItems: "center", justifyContent: "center", color: "#62E0D8", fontWeight: 700, fontSize: 13, flexShrink: 0 }}>S</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#202124" }}>SDR BullsEye</div>
            <div style={{ fontSize: 11, color: "#5f6368" }}>Para: contacto@empresa.cl</div>
          </div>
          <div style={{ fontSize: 11, color: "#5f6368", whiteSpace: "nowrap" }}>Hoy</div>
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.65, color: "#202124", whiteSpace: "pre-line" }}>{body}</div>
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid #e8eaed", fontSize: 12, color: "#5f6368", lineHeight: 1.6 }}>
          <strong style={{ color: "#202124" }}>Tu nombre</strong><br />SDR · BullsEye
        </div>
      </div>
    </div>
  );

  if (channel === "linkedin") return (
    <div className="rounded-xl overflow-hidden" style={{ background: "#f3f2ef", border: "1px solid #e0dfdc" }}>
      <div style={{ background: "#fff", borderBottom: "1px solid #e0dfdc", padding: "8px 14px", display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 22, height: 22, borderRadius: 4, background: "#0a66c2", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 13, fontFamily: "serif", flexShrink: 0 }}>in</div>
        <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(0,0,0,0.9)", fontFamily: "-apple-system,sans-serif" }}>Mensajes</span>
      </div>
      <div style={{ padding: "16px 14px", display: "flex", flexDirection: "column" as const, alignItems: "flex-end" }}>
        <div style={{ background: "#0a66c2", color: "#fff", borderRadius: "16px 16px 4px 16px", padding: "10px 14px", fontSize: 13, lineHeight: 1.55, maxWidth: "88%", fontFamily: "-apple-system,sans-serif", whiteSpace: "pre-line" as const }}>{body}</div>
        <div style={{ fontSize: 11, color: "rgba(0,0,0,0.45)", marginTop: 4, fontFamily: "-apple-system,sans-serif" }}>Enviado</div>
      </div>
    </div>
  );

  // whatsapp
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "#111b21" }}>
      <div style={{ background: "#202c33", borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "8px 14px", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#2a3942", display: "flex", alignItems: "center", justifyContent: "center", color: "#8696a0", fontWeight: 700, fontSize: 12, flexShrink: 0 }}>C</div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#e9edef", fontFamily: "-apple-system,sans-serif" }}>Contacto</div>
          <div style={{ fontSize: 11, color: "#8696a0", fontFamily: "-apple-system,sans-serif" }}>en línea</div>
        </div>
      </div>
      <div style={{ background: "#0b141a", padding: "14px 12px 20px", display: "flex", justifyContent: "flex-end" }}>
        <div style={{ background: "#005c4b", color: "#e9edef", borderRadius: "8px 0 8px 8px", padding: "8px 12px 22px", fontSize: 13.5, lineHeight: 1.55, maxWidth: "88%", fontFamily: "-apple-system,sans-serif", whiteSpace: "pre-line" as const, position: "relative" as const }}>
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
            <button
              onClick={() => setPreview((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[12px] font-medium transition-all hover:opacity-80"
              style={{ background: preview ? "rgba(98,224,216,0.12)" : "#f3f1fc", color: preview ? "#1a9e98" : "#6b66a3", border: `1px solid ${preview ? "rgba(98,224,216,0.4)" : "#e2e0f0"}` }}
            >
              {preview ? "Ocultar" : `Ver como ${channelLabel}`}
            </button>
            <button
              onClick={copy}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[12px] font-medium transition-all hover:opacity-80"
              style={{ background: "#251762", color: "#62E0D8", border: "1px solid transparent" }}
            >
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
          <img src={msg.imagePreview} alt="Captura adjunta" className="rounded-xl max-w-full"
            style={{ maxHeight: 220, objectFit: "contain", border: "1px solid rgba(255,255,255,0.1)" }} />
        )}
        {parsed ? (
          <EmailCard subject={parsed.subject ?? ""} body={parsed.body ?? ""} showSubject={effectiveChannel === "email"} channel={effectiveChannel} />
        ) : (
          <div
            className="rounded-2xl px-4 py-3 text-sm leading-relaxed"
            style={isUser
              ? { background: "#251762", color: "rgba(255,255,255,0.92)" }
              : { background: "#fff", color: "#2d2950", border: "1px solid #e2e0f0" }
            }
          >
            {msg.content}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ChatPage() {
  const [clients, setClients]               = useState<Client[]>([]);
  const [clientId, setClientId]             = useState("");
  const [clientOpen, setClientOpen]         = useState(false);
  const [segments, setSegments]             = useState<Segment[]>([]);
  const [segmentId, setSegmentId]           = useState("");
  const [segmentOpen, setSegmentOpen]       = useState(false);
  const [emailType, setEmailType]           = useState<EmailType>("info");
  const [typeOpen, setTypeOpen]             = useState(false);
  const [channel, setChannel]               = useState<Channel>("email");
  const [recipientName, setRecipientName]   = useState("");
  const [recipientCompany, setRecipientCompany] = useState("");
  const [recipientTitle, setTitle]          = useState("");
  const [referrerName, setReferrer]         = useState("");
  const [meetingDate, setMeetingDate]       = useState("");
  const [contextNotes, setNotes]            = useState("");
  const [messages, setMessages]             = useState<Message[]>([]);
  const [input, setInput]                   = useState("");
  const [pendingImage, setPendingImage]     = useState<{ base64: string; mediaType: string; preview: string } | null>(null);
  const [loading, setLoading]               = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef   = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/clients").then((r) => r.json()).then((j) => setClients(j.clients ?? [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!clientId) { setSegments([]); setSegmentId(""); return; }
    fetch(`/api/training/segments?client_id=${clientId}`)
      .then((r) => r.json()).then((j) => setSegments(j.segments ?? [])).catch(() => {});
  }, [clientId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(userContent: string, isFirst = false, image?: { base64: string; mediaType: string; preview: string } | null) {
    setLoading(true);
    const newMsg: Message = { role: "user", content: userContent, imagePreview: image?.preview };
    const updated = [...messages, newMsg];
    setMessages(updated);
    setPendingImage(null);

    try {
      const apiMessages = updated.map((m) => ({ role: m.role, content: m.content }));

      const res = await fetch("/api/agente-contenido", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          messages:         apiMessages,
          emailType,
          channel,
          segmentId:        segmentId || undefined,
          recipientName,
          recipientCompany,
          recipientTitle,
          referrerName:     emailType === "referral" ? referrerName : undefined,
          meetingDate:      emailType === "meeting"  ? meetingDate  : undefined,
          contextNotes,
          save:             isFirst,
          image:            image ? { base64: image.base64, mediaType: image.mediaType } : undefined,
        }),
      });

      const data = await res.json();
      // Detectar si el usuario pidió cambiar de canal en su mensaje
      const lowerContent = userContent.toLowerCase();
      let effectiveChannel = channel;
      if (lowerContent.includes("linkedin")) effectiveChannel = "linkedin";
      else if (lowerContent.includes("whatsapp")) effectiveChannel = "whatsapp";
      else if (lowerContent.includes("email") || lowerContent.includes("correo")) effectiveChannel = "email";
      setMessages((prev) => [...prev, { role: "assistant", content: data.message ?? data.error ?? "Error al generar.", channel: effectiveChannel }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Error de conexión. Intenta de nuevo." }]);
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
    await send("Genera el correo", true, pendingImage);
  }

  async function handleChat(e: React.FormEvent) {
    e.preventDefault();
    if ((!input.trim() && !pendingImage) || loading) return;
    const text = input.trim() || "Genera una respuesta a esta conversación.";
    setInput("");
    await send(text, false, pendingImage);
  }

  function reset() {
    setMessages([]);
    setInput("");
    setPendingImage(null);
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#f4f2fb" }}>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImagePick} />

      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-6 py-4"
        style={{ background: "#251762", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <div className="flex items-center gap-3">
          <div className="text-[18px] font-bold tracking-tight leading-none">
            <span className="text-white">Bulls</span>
            <span style={{ color: "#62E0D8" }}>Eye</span>
          </div>
          <span className="text-[11px] px-2 py-0.5 rounded-full font-medium"
            style={{ background: "rgba(98,224,216,0.15)", color: "#62E0D8" }}>
            Agente de Contenido
          </span>
        </div>
        {messages.length > 0 && (
          <button onClick={reset} className="flex items-center gap-1.5 text-[12px] transition-opacity hover:opacity-70"
            style={{ color: "rgba(255,255,255,0.55)" }}>
            <IconRefresh size={13} /> Limpiar chat
          </button>
        )}
      </div>

      {/* Cuerpo — dos columnas */}
      <div className="flex-1 flex overflow-hidden" style={{ height: "calc(100vh - 57px)" }}>

        {/* ── Panel izquierdo: formulario ── */}
        <div className="shrink-0 flex flex-col overflow-y-auto"
          style={{ width: 360, background: "#fff", borderRight: "1px solid #e2e0f0" }}>
          <div className="px-6 py-6">
            <p className="text-[12px] mb-5" style={{ color: "#9b97c0" }}>
              Configura el contexto y el agente redacta el mensaje por ti.
            </p>
            <form onSubmit={handleStart} className="space-y-5">

              {/* Cliente */}
              <div className="relative">
                <label className="block text-[11px] uppercase tracking-widest font-semibold mb-2" style={{ color: "#9b97c0" }}>Cliente</label>
                <button type="button" onClick={() => setClientOpen((v) => !v)}
                  className="w-full flex items-center justify-between rounded-xl px-4 py-2.5 text-sm text-left"
                  style={{ background: "#f4f2fb", border: "1px solid #e2e0f0", color: clientId ? "#1a1535" : "#b0acd4" }}>
                  <span>{clients.find((c) => c.id === clientId)?.name ?? "Seleccionar cliente..."}</span>
                  <IconChevronDown size={14} style={{ color: "#b0acd4", transform: clientOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s" }} />
                </button>
                {clientOpen && (
                  <div className="absolute left-0 right-0 top-full mt-1 rounded-xl overflow-y-auto z-20"
                    style={{ background: "#fff", border: "1px solid #e2e0f0", boxShadow: "0 8px 24px rgba(37,23,98,0.12)", maxHeight: 220 }}>
                    {clients.map((c) => (
                      <button type="button" key={c.id}
                        onClick={() => { setClientId(c.id); setClientOpen(false); }}
                        className="w-full text-left px-4 py-2.5 text-sm transition hover:bg-[#f4f2fb]"
                        style={{ color: clientId === c.id ? "#251762" : "#2d2950", fontWeight: clientId === c.id ? 600 : 400 }}>
                        {c.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Tipo de mensaje */}
              <div className="relative">
                <label className="block text-[11px] uppercase tracking-widest font-semibold mb-2" style={{ color: "#9b97c0" }}>Tipo de mensaje</label>
                <button type="button" onClick={() => setTypeOpen((v) => !v)}
                  className="w-full flex items-center justify-between rounded-xl px-4 py-2.5 text-sm text-left"
                  style={{ background: "#f4f2fb", border: "1px solid #e2e0f0", color: "#1a1535" }}>
                  <span>{MSG_TYPE_LABELS[emailType]}</span>
                  <IconChevronDown size={14} style={{ color: "#b0acd4", transform: typeOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s" }} />
                </button>
                {typeOpen && (
                  <div className="absolute left-0 right-0 top-full mt-1 rounded-xl overflow-hidden z-20"
                    style={{ background: "#fff", border: "1px solid #e2e0f0", boxShadow: "0 8px 24px rgba(37,23,98,0.12)" }}>
                    {(Object.entries(MSG_TYPE_LABELS) as [EmailType, string][]).map(([val, label]) => (
                      <button type="button" key={val}
                        onClick={() => { setEmailType(val); setTypeOpen(false); }}
                        className="w-full text-left px-4 py-2.5 text-sm transition hover:bg-[#f4f2fb]"
                        style={{ color: emailType === val ? "#251762" : "#2d2950", fontWeight: emailType === val ? 600 : 400 }}>
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Canal */}
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-semibold mb-2" style={{ color: "#9b97c0" }}>Canal</label>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.entries(CHANNEL_LABELS) as [Channel, string][]).map(([val, label]) => (
                    <button type="button" key={val}
                      onClick={() => setChannel(val)}
                      className="py-2.5 rounded-xl text-sm font-medium transition"
                      style={{
                        background: channel === val ? "#251762" : "#f4f2fb",
                        border: `1px solid ${channel === val ? "#251762" : "#e2e0f0"}`,
                        color: channel === val ? "#62E0D8" : "#6b66a3",
                      }}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Guía de estilo */}
              {segments.length > 0 && (
                <div className="relative">
                  <label className="block text-[11px] uppercase tracking-widest font-semibold mb-2" style={{ color: "#9b97c0" }}>
                    Guía de estilo <span style={{ fontWeight: 400 }}>(opcional)</span>
                  </label>
                  <button type="button" onClick={() => setSegmentOpen((v) => !v)}
                    className="w-full flex items-center justify-between rounded-xl px-4 py-2.5 text-sm text-left"
                    style={{ background: "#f4f2fb", border: "1px solid #e2e0f0", color: segmentId ? "#1a1535" : "#b0acd4" }}>
                    <span>{segments.find((s) => s.id === segmentId)?.name ?? "Sin segmentación específica"}</span>
                    <IconChevronDown size={14} style={{ color: "#b0acd4", transform: segmentOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s" }} />
                  </button>
                  {segmentOpen && (
                    <div className="absolute left-0 right-0 top-full mt-1 rounded-xl overflow-hidden z-20"
                      style={{ background: "#fff", border: "1px solid #e2e0f0", boxShadow: "0 8px 24px rgba(37,23,98,0.12)" }}>
                      <button type="button" onClick={() => { setSegmentId(""); setSegmentOpen(false); }}
                        className="w-full text-left px-4 py-2.5 text-sm transition hover:bg-[#f4f2fb]"
                        style={{ color: !segmentId ? "#251762" : "#9b97c0", fontWeight: !segmentId ? 600 : 400 }}>
                        Sin segmentación específica
                      </button>
                      {segments.map((s) => (
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
                  <input type="text" value={recipientName} onChange={(e) => setRecipientName(e.target.value)}
                    placeholder="Ej: María González"
                    className="w-full rounded-xl px-4 py-2.5 text-sm outline-none"
                    style={{ background: "#f4f2fb", border: "1px solid #e2e0f0", color: "#1a1535" }} />
                </div>
                <div>
                  <label className="block text-[11px] uppercase tracking-widest font-semibold mb-2" style={{ color: "#9b97c0" }}>Empresa</label>
                  <input type="text" value={recipientCompany} onChange={(e) => setRecipientCompany(e.target.value)}
                    placeholder="Ej: Clínica Norte"
                    className="w-full rounded-xl px-4 py-2.5 text-sm outline-none"
                    style={{ background: "#f4f2fb", border: "1px solid #e2e0f0", color: "#1a1535" }} />
                </div>
              </div>

              {/* Cargo */}
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-semibold mb-2" style={{ color: "#9b97c0" }}>Cargo del destinatario</label>
                <input type="text" value={recipientTitle} onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ej: Director de Operaciones"
                  className="w-full rounded-xl px-4 py-2.5 text-sm outline-none"
                  style={{ background: "#f4f2fb", border: "1px solid #e2e0f0", color: "#1a1535" }} />
              </div>

              {/* Derivación */}
              {emailType === "referral" && (
                <div>
                  <label className="block text-[11px] uppercase tracking-widest font-semibold mb-2" style={{ color: "#9b97c0" }}>¿Quién los derivó?</label>
                  <input type="text" value={referrerName} onChange={(e) => setReferrer(e.target.value)}
                    placeholder="Ej: Juan Pérez"
                    className="w-full rounded-xl px-4 py-2.5 text-sm outline-none"
                    style={{ background: "#f4f2fb", border: "1px solid #e2e0f0", color: "#1a1535" }} />
                </div>
              )}

              {/* Fecha de reunión */}
              {emailType === "meeting" && (
                <div>
                  <label className="block text-[11px] uppercase tracking-widest font-semibold mb-2" style={{ color: "#9b97c0" }}>Fecha y hora de la reunión</label>
                  <input type="datetime-local" value={meetingDate} onChange={(e) => setMeetingDate(e.target.value)}
                    className="w-full rounded-xl px-4 py-2.5 text-sm outline-none"
                    style={{ background: "#f4f2fb", border: "1px solid #e2e0f0", color: meetingDate ? "#1a1535" : "#b0acd4" }} />
                </div>
              )}

              {/* Contexto adicional + imagen */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[11px] uppercase tracking-widest font-semibold" style={{ color: "#9b97c0" }}>
                    Contexto adicional <span style={{ fontWeight: 400 }}>(opcional)</span>
                  </label>
                  <button type="button" onClick={() => fileRef.current?.click()}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] transition hover:opacity-80"
                    style={{ background: pendingImage ? "rgba(37,23,98,0.08)" : "#f4f2fb", border: "1px solid #e2e0f0",
                      color: pendingImage ? "#251762" : "#9b97c0" }}>
                    <IconPhoto size={13} />
                    {pendingImage ? "Imagen lista" : "Adjuntar imagen"}
                  </button>
                </div>
                <textarea value={contextNotes} onChange={(e) => setNotes(e.target.value)}
                  placeholder="Ej: El cliente me pide esto, ver imagen adjunta..."
                  rows={3} className="w-full rounded-xl px-4 py-2.5 text-sm outline-none resize-none"
                  style={{ background: "#f4f2fb", border: "1px solid #e2e0f0", color: "#1a1535" }} />
                {pendingImage && (
                  <div className="mt-2 relative inline-block">
                    <img src={pendingImage.preview} alt="Imagen adjunta" className="rounded-xl"
                      style={{ maxHeight: 120, maxWidth: "100%", objectFit: "contain", border: "1px solid #e2e0f0" }} />
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
                {messages.length > 0 ? "Regenerar" : "Generar correo"}
              </button>
            </form>
          </div>
        </div>

        {/* ── Panel derecho: chat ── */}
        <div className="flex-1 flex flex-col overflow-hidden" style={{ background: "#f4f2fb" }}>
          {messages.length === 0 && !loading ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
                style={{ background: "#ede9fb", border: "1px solid #e2e0f0" }}>
                <IconSparkles size={22} style={{ color: "#251762", opacity: 0.5 }} />
              </div>
              <p className="text-sm text-center" style={{ color: "#b0acd4", maxWidth: 260 }}>
                Completa el formulario y haz clic en{" "}
                <strong style={{ color: "#6b66a3" }}>Generar correo</strong> para empezar.
              </p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto px-6 py-6">
              {messages.map((msg, i) => <Bubble key={i} msg={msg} channel={channel} />)}
              {loading && (
                <div className="flex gap-3 mb-5">
                  <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
                    style={{ background: "#ede9fb" }}>
                    <IconSparkles size={15} style={{ color: "#251762" }} />
                  </div>
                  <div className="rounded-2xl px-4 py-3 text-sm"
                    style={{ background: "#fff", border: "1px solid #e2e0f0" }}>
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
                  <img src={pendingImage.preview} alt="Imagen a enviar" className="rounded-xl"
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
                  className="shrink-0 px-3 rounded-xl transition hover:opacity-80 disabled:opacity-30"
                  style={{ background: "#f4f2fb", border: "1px solid #e2e0f0", color: pendingImage ? "#251762" : "#b0acd4" }}
                  title="Adjuntar captura">
                  <IconPhoto size={17} />
                </button>
                <input type="text" value={input} onChange={(e) => setInput(e.target.value)}
                  placeholder={pendingImage ? "Añade instrucciones o envía directamente…" : "Pide ajustes, variaciones, otro tono…"}
                  disabled={loading}
                  className="flex-1 rounded-xl px-4 py-2.5 text-sm outline-none"
                  style={{ background: "#f4f2fb", border: "1px solid #e2e0f0", color: "#1a1535" }} />
                <button type="submit" disabled={(!input.trim() && !pendingImage) || loading}
                  className="px-4 rounded-xl transition hover:opacity-80 disabled:opacity-30"
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
