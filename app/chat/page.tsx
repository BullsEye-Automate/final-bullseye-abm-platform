"use client";

import { useState, useRef, useEffect } from "react";
import {
  IconSend, IconCopy, IconCheck, IconSparkles, IconRefresh,
  IconChevronDown, IconPhoto, IconX,
} from "@tabler/icons-react";

type EmailType = "info" | "referral" | "cold" | "meeting";
type Channel   = "email" | "whatsapp" | "linkedin";
type Message   = { role: "user" | "assistant"; content: string; imagePreview?: string };

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
    <div className="rounded-2xl overflow-hidden" style={{ background: "#1a1040", border: "1px solid rgba(98,224,216,0.25)" }}>
      {showSubject && subject && (
        <div className="px-5 py-4" style={{ borderBottom: "1px solid rgba(98,224,216,0.12)" }}>
          <p className="text-[10px] uppercase tracking-widest mb-1 font-medium" style={{ color: "#62E0D8", opacity: 0.7 }}>Asunto</p>
          <p className="text-sm font-semibold text-white">{subject}</p>
        </div>
      )}
      <div className="px-5 py-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] uppercase tracking-widest font-medium" style={{ color: "#62E0D8", opacity: 0.7 }}>Mensaje</p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPreview((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[12px] font-medium transition-opacity hover:opacity-70"
              style={{ background: preview ? "rgba(98,224,216,0.2)" : "rgba(255,255,255,0.07)", color: preview ? "#62E0D8" : "rgba(255,255,255,0.45)" }}
            >
              {preview ? "Ocultar" : `Ver como ${channelLabel}`}
            </button>
            <button
              onClick={copy}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[12px] font-medium transition-opacity hover:opacity-70"
              style={{ background: "rgba(98,224,216,0.15)", color: "#62E0D8" }}
            >
              {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
              {copied ? "Copiado" : "Copiar"}
            </button>
          </div>
        </div>
        <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: "rgba(255,255,255,0.82)" }}>{body}</p>
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
  const parsed = !isUser ? parseEmail(msg.content) : null;

  return (
    <div className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"} mb-5`}>
      {!isUser && (
        <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center mt-0.5" style={{ background: "rgba(98,224,216,0.12)" }}>
          <IconSparkles size={15} style={{ color: "#62E0D8" }} />
        </div>
      )}
      <div className="max-w-[85%] flex flex-col gap-2">
        {msg.imagePreview && (
          <img src={msg.imagePreview} alt="Captura adjunta" className="rounded-xl max-w-full"
            style={{ maxHeight: 220, objectFit: "contain", border: "1px solid rgba(255,255,255,0.1)" }} />
        )}
        {parsed ? (
          <EmailCard subject={parsed.subject ?? ""} body={parsed.body ?? ""} showSubject={channel === "email"} channel={channel} />
        ) : (
          <div
            className="rounded-2xl px-4 py-3 text-sm leading-relaxed"
            style={isUser
              ? { background: "#251762", color: "rgba(255,255,255,0.9)", border: "1px solid rgba(255,255,255,0.08)" }
              : { background: "#1a1040", color: "rgba(255,255,255,0.82)", border: "1px solid rgba(255,255,255,0.07)" }
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
      setMessages((prev) => [...prev, { role: "assistant", content: data.message ?? data.error ?? "Error al generar." }]);
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
    <div className="min-h-screen flex flex-col" style={{ background: "#0d0825" }}>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImagePick} />

      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-6 py-4"
        style={{ background: "#160e3a", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <div className="flex items-center gap-3">
          <div className="text-[18px] font-bold tracking-tight leading-none">
            <span className="text-white">Bulls</span>
            <span style={{ color: "#62E0D8" }}>Eye</span>
          </div>
          <span className="text-[11px] px-2 py-0.5 rounded-full font-medium"
            style={{ background: "rgba(98,224,216,0.1)", color: "#62E0D8" }}>
            Agente de Contenido
          </span>
        </div>
        {messages.length > 0 && (
          <button onClick={reset} className="flex items-center gap-1.5 text-[12px] transition-opacity hover:opacity-60"
            style={{ color: "rgba(255,255,255,0.4)" }}>
            <IconRefresh size={13} /> Limpiar chat
          </button>
        )}
      </div>

      {/* Cuerpo — dos columnas */}
      <div className="flex-1 flex overflow-hidden" style={{ height: "calc(100vh - 57px)" }}>

        {/* ── Panel izquierdo: formulario ── */}
        <div className="shrink-0 flex flex-col overflow-y-auto"
          style={{ width: 360, background: "#110c30", borderRight: "1px solid rgba(255,255,255,0.07)" }}>
          <div className="px-6 py-6">
            <p className="text-[12px] mb-5" style={{ color: "rgba(255,255,255,0.4)" }}>
              Configura el contexto y el agente redacta el mensaje por ti.
            </p>
            <form onSubmit={handleStart} className="space-y-5">

              {/* Cliente */}
              <div className="relative">
                <label className="block text-[11px] uppercase tracking-widest font-medium mb-2"
                  style={{ color: "rgba(255,255,255,0.4)" }}>Cliente</label>
                <button type="button" onClick={() => setClientOpen((v) => !v)}
                  className="w-full flex items-center justify-between rounded-xl px-4 py-2.5 text-sm text-left"
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
                    color: clientId ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.35)" }}>
                  <span>{clients.find((c) => c.id === clientId)?.name ?? "Seleccionar cliente..."}</span>
                  <IconChevronDown size={14} style={{ opacity: 0.5, transform: clientOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s" }} />
                </button>
                {clientOpen && (
                  <div className="absolute left-0 right-0 top-full mt-1 rounded-xl overflow-y-auto z-20"
                    style={{ background: "#1e1450", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 8px 24px rgba(0,0,0,0.4)", maxHeight: 220 }}>
                    {clients.map((c) => (
                      <button type="button" key={c.id}
                        onClick={() => { setClientId(c.id); setClientOpen(false); }}
                        className="w-full text-left px-4 py-2.5 text-sm transition hover:bg-white/10"
                        style={{ color: clientId === c.id ? "#62E0D8" : "rgba(255,255,255,0.8)" }}>
                        {c.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Tipo de mensaje */}
              <div className="relative">
                <label className="block text-[11px] uppercase tracking-widest font-medium mb-2"
                  style={{ color: "rgba(255,255,255,0.4)" }}>Tipo de mensaje</label>
                <button type="button" onClick={() => setTypeOpen((v) => !v)}
                  className="w-full flex items-center justify-between rounded-xl px-4 py-2.5 text-sm text-left"
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.9)" }}>
                  <span>{MSG_TYPE_LABELS[emailType]}</span>
                  <IconChevronDown size={14} style={{ opacity: 0.5, transform: typeOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s" }} />
                </button>
                {typeOpen && (
                  <div className="absolute left-0 right-0 top-full mt-1 rounded-xl overflow-hidden z-20"
                    style={{ background: "#1e1450", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
                    {(Object.entries(MSG_TYPE_LABELS) as [EmailType, string][]).map(([val, label]) => (
                      <button type="button" key={val}
                        onClick={() => { setEmailType(val); setTypeOpen(false); }}
                        className="w-full text-left px-4 py-2.5 text-sm transition hover:bg-white/10"
                        style={{ color: emailType === val ? "#62E0D8" : "rgba(255,255,255,0.8)" }}>
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Canal */}
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-medium mb-2"
                  style={{ color: "rgba(255,255,255,0.4)" }}>Canal</label>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.entries(CHANNEL_LABELS) as [Channel, string][]).map(([val, label]) => (
                    <button type="button" key={val}
                      onClick={() => setChannel(val)}
                      className="py-2.5 rounded-xl text-sm font-medium transition"
                      style={{
                        background: channel === val ? "rgba(98,224,216,0.15)" : "rgba(255,255,255,0.05)",
                        border: `1px solid ${channel === val ? "rgba(98,224,216,0.4)" : "rgba(255,255,255,0.08)"}`,
                        color: channel === val ? "#62E0D8" : "rgba(255,255,255,0.55)",
                      }}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Guía de estilo (solo si el cliente tiene segmentos) */}
              {segments.length > 0 && (
                <div className="relative">
                  <label className="block text-[11px] uppercase tracking-widest font-medium mb-2"
                    style={{ color: "rgba(255,255,255,0.4)" }}>Guía de estilo <span style={{ opacity: 0.5 }}>(opcional)</span></label>
                  <button type="button" onClick={() => setSegmentOpen((v) => !v)}
                    className="w-full flex items-center justify-between rounded-xl px-4 py-2.5 text-sm text-left"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
                      color: segmentId ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.35)" }}>
                    <span>{segments.find((s) => s.id === segmentId)?.name ?? "Sin segmentación específica"}</span>
                    <IconChevronDown size={14} style={{ opacity: 0.5, transform: segmentOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s" }} />
                  </button>
                  {segmentOpen && (
                    <div className="absolute left-0 right-0 top-full mt-1 rounded-xl overflow-hidden z-20"
                      style={{ background: "#1e1450", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
                      <button type="button" onClick={() => { setSegmentId(""); setSegmentOpen(false); }}
                        className="w-full text-left px-4 py-2.5 text-sm transition hover:bg-white/10"
                        style={{ color: !segmentId ? "#62E0D8" : "rgba(255,255,255,0.5)" }}>
                        Sin segmentación específica
                      </button>
                      {segments.map((s) => (
                        <button type="button" key={s.id}
                          onClick={() => { setSegmentId(s.id); setSegmentOpen(false); }}
                          className="w-full text-left px-4 py-2.5 text-sm transition hover:bg-white/10"
                          style={{ color: segmentId === s.id ? "#62E0D8" : "rgba(255,255,255,0.8)" }}>
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
                  <label className="block text-[11px] uppercase tracking-widest font-medium mb-2"
                    style={{ color: "rgba(255,255,255,0.4)" }}>Nombre</label>
                  <input type="text" value={recipientName} onChange={(e) => setRecipientName(e.target.value)}
                    placeholder="Ej: María González"
                    className="w-full rounded-xl px-4 py-2.5 text-sm outline-none placeholder:opacity-25"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.9)" }} />
                </div>
                <div>
                  <label className="block text-[11px] uppercase tracking-widest font-medium mb-2"
                    style={{ color: "rgba(255,255,255,0.4)" }}>Empresa</label>
                  <input type="text" value={recipientCompany} onChange={(e) => setRecipientCompany(e.target.value)}
                    placeholder="Ej: Clínica Norte"
                    className="w-full rounded-xl px-4 py-2.5 text-sm outline-none placeholder:opacity-25"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.9)" }} />
                </div>
              </div>

              {/* Cargo */}
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-medium mb-2"
                  style={{ color: "rgba(255,255,255,0.4)" }}>Cargo del destinatario</label>
                <input type="text" value={recipientTitle} onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ej: Director de Operaciones"
                  className="w-full rounded-xl px-4 py-2.5 text-sm outline-none placeholder:opacity-25"
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.9)" }} />
              </div>

              {/* Derivación (solo tipo referral) */}
              {emailType === "referral" && (
                <div>
                  <label className="block text-[11px] uppercase tracking-widest font-medium mb-2"
                    style={{ color: "rgba(255,255,255,0.4)" }}>¿Quién los derivó?</label>
                  <input type="text" value={referrerName} onChange={(e) => setReferrer(e.target.value)}
                    placeholder="Ej: Juan Pérez"
                    className="w-full rounded-xl px-4 py-2.5 text-sm outline-none placeholder:opacity-25"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.9)" }} />
                </div>
              )}

              {/* Fecha de reunión (solo tipo meeting) */}
              {emailType === "meeting" && (
                <div>
                  <label className="block text-[11px] uppercase tracking-widest font-medium mb-2"
                    style={{ color: "rgba(255,255,255,0.4)" }}>Fecha y hora de la reunión</label>
                  <input type="datetime-local" value={meetingDate} onChange={(e) => setMeetingDate(e.target.value)}
                    className="w-full rounded-xl px-4 py-2.5 text-sm outline-none"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
                      color: meetingDate ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.35)",
                      colorScheme: "dark" }} />
                </div>
              )}

              {/* Contexto adicional + imagen */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[11px] uppercase tracking-widest font-medium"
                    style={{ color: "rgba(255,255,255,0.4)" }}>
                    Contexto adicional <span style={{ opacity: 0.5 }}>(opcional)</span>
                  </label>
                  <button type="button" onClick={() => fileRef.current?.click()}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] transition hover:opacity-80"
                    style={{ background: pendingImage ? "rgba(98,224,216,0.15)" : "rgba(255,255,255,0.06)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      color: pendingImage ? "#62E0D8" : "rgba(255,255,255,0.45)" }}>
                    <IconPhoto size={13} />
                    {pendingImage ? "Imagen lista" : "Adjuntar imagen"}
                  </button>
                </div>
                <textarea value={contextNotes} onChange={(e) => setNotes(e.target.value)}
                  placeholder="Ej: El cliente me pide esto, ver imagen adjunta..."
                  rows={3} className="w-full rounded-xl px-4 py-2.5 text-sm outline-none resize-none placeholder:opacity-25"
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.9)" }} />
                {pendingImage && (
                  <div className="mt-2 relative inline-block">
                    <img src={pendingImage.preview} alt="Imagen adjunta" className="rounded-xl"
                      style={{ maxHeight: 120, maxWidth: "100%", objectFit: "contain", border: "1px solid rgba(98,224,216,0.3)" }} />
                    <button type="button" onClick={() => setPendingImage(null)}
                      className="absolute -top-2 -right-2 w-5 h-5 rounded-full flex items-center justify-center"
                      style={{ background: "#0d0825", border: "1px solid rgba(255,255,255,0.2)" }}>
                      <IconX size={11} style={{ color: "rgba(255,255,255,0.6)" }} />
                    </button>
                  </div>
                )}
              </div>

              <button type="submit" disabled={!clientId}
                className="w-full py-3 rounded-xl text-sm font-semibold transition hover:opacity-90 disabled:opacity-30 flex items-center justify-center gap-2"
                style={{ background: "#62E0D8", color: "#0d0825" }}>
                <IconSparkles size={15} />
                {messages.length > 0 ? "Regenerar" : "Generar correo"}
              </button>
            </form>
          </div>
        </div>

        {/* ── Panel derecho: chat ── */}
        <div className="flex-1 flex flex-col overflow-hidden" style={{ background: "#0d0825" }}>
          {messages.length === 0 && !loading ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
                style={{ background: "rgba(98,224,216,0.08)", border: "1px solid rgba(98,224,216,0.15)" }}>
                <IconSparkles size={22} style={{ color: "#62E0D8", opacity: 0.6 }} />
              </div>
              <p className="text-sm text-center" style={{ color: "rgba(255,255,255,0.25)", maxWidth: 260 }}>
                Completa el formulario y haz clic en{" "}
                <strong style={{ color: "rgba(255,255,255,0.4)" }}>Generar correo</strong> para empezar.
              </p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto px-6 py-6">
              {messages.map((msg, i) => <Bubble key={i} msg={msg} channel={channel} />)}
              {loading && (
                <div className="flex gap-3 mb-5">
                  <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
                    style={{ background: "rgba(98,224,216,0.12)" }}>
                    <IconSparkles size={15} style={{ color: "#62E0D8" }} />
                  </div>
                  <div className="rounded-2xl px-4 py-3 text-sm"
                    style={{ background: "#1a1040", border: "1px solid rgba(255,255,255,0.07)" }}>
                    <span className="animate-pulse" style={{ color: "rgba(255,255,255,0.35)" }}>Escribiendo...</span>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}

          {(messages.length > 0 || loading) && (
            <div className="shrink-0 px-6 pb-6 pt-2" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              {pendingImage && (
                <div className="mb-2 relative inline-block">
                  <img src={pendingImage.preview} alt="Imagen a enviar" className="rounded-xl"
                    style={{ maxHeight: 100, maxWidth: 200, objectFit: "contain", border: "1px solid rgba(98,224,216,0.3)" }} />
                  <button type="button" onClick={() => setPendingImage(null)}
                    className="absolute -top-2 -right-2 w-5 h-5 rounded-full flex items-center justify-center"
                    style={{ background: "#0d0825", border: "1px solid rgba(255,255,255,0.2)" }}>
                    <IconX size={11} style={{ color: "rgba(255,255,255,0.6)" }} />
                  </button>
                </div>
              )}
              <form onSubmit={handleChat} className="flex gap-2">
                <button type="button" onClick={() => fileRef.current?.click()} disabled={loading}
                  className="shrink-0 px-3 rounded-xl transition hover:opacity-80 disabled:opacity-30"
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
                    color: pendingImage ? "#62E0D8" : "rgba(255,255,255,0.4)" }}
                  title="Adjuntar captura">
                  <IconPhoto size={17} />
                </button>
                <input type="text" value={input} onChange={(e) => setInput(e.target.value)}
                  placeholder={pendingImage ? "Añade instrucciones o envía directamente…" : "Pide ajustes, variaciones, otro tono…"}
                  disabled={loading}
                  className="flex-1 rounded-xl px-4 py-2.5 text-sm outline-none placeholder:opacity-25"
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.9)" }} />
                <button type="submit" disabled={(!input.trim() && !pendingImage) || loading}
                  className="px-4 rounded-xl transition hover:opacity-80 disabled:opacity-30"
                  style={{ background: "#62E0D8", color: "#0d0825" }}>
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
