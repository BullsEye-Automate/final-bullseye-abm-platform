"use client";

import { useState, useRef, useEffect } from "react";
import {
  IconSend,
  IconCopy,
  IconCheck,
  IconRefresh,
  IconSparkles,
  IconMail,
} from "@tabler/icons-react";
import { useClient } from "@/lib/clientContext";

type EmailType = "info" | "referral" | "cold";
type Message = { role: "user" | "assistant"; content: string };

const EMAIL_TYPES: { value: EmailType; label: string; desc: string }[] = [
  { value: "info",     label: "Más información", desc: "El prospecto pidió más detalle sobre el servicio" },
  { value: "referral", label: "Derivación",       desc: "Alguien los refirió al prospecto" },
  { value: "cold",     label: "Primer contacto",  desc: "Cold email inicial para un prospecto nuevo" },
];

function parseEmailFromText(text: string): { subject: string; body: string } | null {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch {}
  return null;
}

function EmailCard({ subject, body, onCopy }: { subject: string; body: string; onCopy: () => void }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(`Asunto: ${subject}\n\n${body}`);
    setCopied(true);
    onCopy();
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div
      className="rounded-xl p-4 mt-2"
      style={{ background: "rgba(98,224,216,0.08)", border: "1px solid rgba(98,224,216,0.25)" }}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "rgba(98,224,216,0.7)" }}>
            Asunto
          </p>
          <p className="text-sm font-semibold text-white">{subject}</p>
        </div>
        <button
          onClick={handleCopy}
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition hover:opacity-80"
          style={{ background: "rgba(98,224,216,0.15)", color: "#62E0D8" }}
        >
          {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
          {copied ? "Copiado" : "Copiar"}
        </button>
      </div>
      <div style={{ borderTop: "1px solid rgba(98,224,216,0.15)" }} className="pt-3">
        <p className="text-[10px] uppercase tracking-wider mb-2" style={{ color: "rgba(98,224,216,0.7)" }}>
          Cuerpo
        </p>
        <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: "rgba(255,255,255,0.85)" }}>
          {body}
        </p>
      </div>
    </div>
  );
}

function ChatMessage({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  const parsed = !isUser ? parseEmailFromText(msg.content) : null;

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-4`}>
      {!isUser && (
        <div
          className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center mr-2 mt-0.5"
          style={{ background: "rgba(98,224,216,0.15)" }}
        >
          <IconSparkles size={14} style={{ color: "#62E0D8" }} />
        </div>
      )}
      <div className={`max-w-[80%] ${isUser ? "order-first" : ""}`}>
        {parsed ? (
          <EmailCard subject={parsed.subject ?? ""} body={parsed.body ?? ""} onCopy={() => {}} />
        ) : (
          <div
            className="rounded-xl px-4 py-3 text-sm leading-relaxed"
            style={
              isUser
                ? { background: "#251762", color: "rgba(255,255,255,0.9)", border: "1px solid rgba(255,255,255,0.1)" }
                : { background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.85)", border: "1px solid rgba(255,255,255,0.08)" }
            }
          >
            {msg.content}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AgenteContenidoPage() {
  const { clients, currentClient } = useClient();

  // Estado del formulario
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [emailType, setEmailType]   = useState<EmailType>("info");
  const [recipientTitle, setRecipientTitle] = useState("");
  const [referrerName, setReferrerName]     = useState("");
  const [contextNotes, setContextNotes]     = useState("");
  const [formSubmitted, setFormSubmitted]   = useState(false);

  // Estado del chat
  const [messages, setMessages]   = useState<Message[]>([]);
  const [input, setInput]         = useState("");
  const [loading, setLoading]     = useState(false);
  const [saved, setSaved]         = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Pre-selecciona el cliente activo del sidebar
  useEffect(() => {
    if (currentClient && currentClient.id !== "__all__") {
      setSelectedClientId(currentClient.id);
    }
  }, [currentClient]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage(userContent: string, isFirst = false) {
    if (!selectedClientId) return;
    setLoading(true);

    const newUserMsg: Message = { role: "user", content: userContent };
    const updatedMessages = [...messages, newUserMsg];
    setMessages(updatedMessages);

    const res = await fetch("/api/agente-contenido", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId:       selectedClientId,
        messages:       updatedMessages,
        emailType:      isFirst ? emailType      : undefined,
        recipientTitle: isFirst ? recipientTitle : undefined,
        referrerName:   isFirst ? (emailType === "referral" ? referrerName : undefined) : undefined,
        contextNotes:   isFirst ? contextNotes   : undefined,
        save:           isFirst,
      }),
    });

    const data = await res.json();
    const assistantMsg: Message = { role: "assistant", content: data.message ?? "Error al generar." };
    setMessages((prev) => [...prev, assistantMsg]);
    if (isFirst && data.parsed) setSaved(true);
    setLoading(false);
  }

  async function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormSubmitted(true);
    await sendMessage("Genera el correo", true);
  }

  async function handleChatSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || loading) return;
    const text = input.trim();
    setInput("");
    await sendMessage(text, false);
  }

  function handleReset() {
    setMessages([]);
    setFormSubmitted(false);
    setSaved(false);
    setInput("");
  }

  return (
    <main className="flex flex-col h-screen bg-[#0f0a2e]">
      {/* Header */}
      <div
        className="shrink-0 px-6 py-4 flex items-center justify-between"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: "rgba(98,224,216,0.15)" }}
          >
            <IconMail size={16} style={{ color: "#62E0D8" }} />
          </div>
          <div>
            <h1 className="text-base font-semibold text-white">Agente de Contenido</h1>
            <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.4)" }}>
              Genera correos personalizados para tu cliente
            </p>
          </div>
        </div>
        {formSubmitted && (
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] transition hover:opacity-80"
            style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.6)" }}
          >
            <IconRefresh size={13} />
            Nuevo correo
          </button>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Panel izquierdo: formulario de contexto */}
        <aside
          className="w-[300px] shrink-0 overflow-y-auto p-5"
          style={{ borderRight: "1px solid rgba(255,255,255,0.08)" }}
        >
          <form onSubmit={handleFormSubmit} className="space-y-5">
            {/* Cliente */}
            <div>
              <label className="block text-[11px] font-medium uppercase tracking-wider mb-1.5" style={{ color: "rgba(255,255,255,0.5)" }}>
                Cliente
              </label>
              <select
                value={selectedClientId}
                onChange={(e) => setSelectedClientId(e.target.value)}
                required
                disabled={formSubmitted}
                className="w-full rounded-lg px-3 py-2 text-sm outline-none disabled:opacity-50"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border:     "1px solid rgba(255,255,255,0.1)",
                  color:      "rgba(255,255,255,0.9)",
                }}
              >
                <option value="">Seleccionar...</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            {/* Tipo de correo */}
            <div>
              <label className="block text-[11px] font-medium uppercase tracking-wider mb-1.5" style={{ color: "rgba(255,255,255,0.5)" }}>
                Tipo de correo
              </label>
              <div className="space-y-2">
                {EMAIL_TYPES.map((t) => (
                  <label
                    key={t.value}
                    className="flex items-start gap-2.5 cursor-pointer rounded-lg p-2.5 transition"
                    style={{
                      background: emailType === t.value ? "rgba(98,224,216,0.1)" : "rgba(255,255,255,0.04)",
                      border:     emailType === t.value ? "1px solid rgba(98,224,216,0.3)" : "1px solid rgba(255,255,255,0.08)",
                    }}
                  >
                    <input
                      type="radio"
                      name="emailType"
                      value={t.value}
                      checked={emailType === t.value}
                      onChange={() => setEmailType(t.value)}
                      disabled={formSubmitted}
                      className="mt-0.5 accent-[#62E0D8]"
                    />
                    <div>
                      <p className="text-sm font-medium" style={{ color: emailType === t.value ? "#62E0D8" : "rgba(255,255,255,0.85)" }}>
                        {t.label}
                      </p>
                      <p className="text-[11px] mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>
                        {t.desc}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Cargo del destinatario */}
            <div>
              <label className="block text-[11px] font-medium uppercase tracking-wider mb-1.5" style={{ color: "rgba(255,255,255,0.5)" }}>
                Cargo del destinatario
              </label>
              <input
                type="text"
                value={recipientTitle}
                onChange={(e) => setRecipientTitle(e.target.value)}
                placeholder="Ej: Director de Operaciones"
                disabled={formSubmitted}
                className="w-full rounded-lg px-3 py-2 text-sm outline-none placeholder:opacity-30 disabled:opacity-50"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border:     "1px solid rgba(255,255,255,0.1)",
                  color:      "rgba(255,255,255,0.9)",
                }}
              />
            </div>

            {/* Derivación (solo si tipo = referral) */}
            {emailType === "referral" && (
              <div>
                <label className="block text-[11px] font-medium uppercase tracking-wider mb-1.5" style={{ color: "rgba(255,255,255,0.5)" }}>
                  ¿Quién los derivó?
                </label>
                <input
                  type="text"
                  value={referrerName}
                  onChange={(e) => setReferrerName(e.target.value)}
                  placeholder="Nombre de la persona"
                  disabled={formSubmitted}
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none placeholder:opacity-30 disabled:opacity-50"
                  style={{
                    background: "rgba(255,255,255,0.06)",
                    border:     "1px solid rgba(255,255,255,0.1)",
                    color:      "rgba(255,255,255,0.9)",
                  }}
                />
              </div>
            )}

            {/* Notas adicionales */}
            <div>
              <label className="block text-[11px] font-medium uppercase tracking-wider mb-1.5" style={{ color: "rgba(255,255,255,0.5)" }}>
                Contexto adicional <span style={{ color: "rgba(255,255,255,0.3)" }}>(opcional)</span>
              </label>
              <textarea
                value={contextNotes}
                onChange={(e) => setContextNotes(e.target.value)}
                placeholder="Ej: El prospecto mencionó que usan tecnología X..."
                disabled={formSubmitted}
                rows={3}
                className="w-full rounded-lg px-3 py-2 text-sm outline-none resize-none placeholder:opacity-30 disabled:opacity-50"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border:     "1px solid rgba(255,255,255,0.1)",
                  color:      "rgba(255,255,255,0.9)",
                }}
              />
            </div>

            {!formSubmitted && (
              <button
                type="submit"
                disabled={!selectedClientId || loading}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition hover:opacity-90 disabled:opacity-40"
                style={{ background: "#62E0D8", color: "#0f0a2e" }}
              >
                <IconSparkles size={15} />
                Generar correo
              </button>
            )}

            {saved && (
              <p className="text-center text-[11px]" style={{ color: "rgba(98,224,216,0.7)" }}>
                ✓ Correo guardado en historial
              </p>
            )}
          </form>
        </aside>

        {/* Panel derecho: chat */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Mensajes */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {messages.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <div className="text-center">
                  <div
                    className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4"
                    style={{ background: "rgba(98,224,216,0.1)" }}
                  >
                    <IconSparkles size={22} style={{ color: "#62E0D8" }} />
                  </div>
                  <p className="text-sm font-medium text-white mb-1">Completa el formulario</p>
                  <p className="text-[12px]" style={{ color: "rgba(255,255,255,0.35)" }}>
                    Configura el contexto a la izquierda y genera tu correo
                  </p>
                </div>
              </div>
            ) : (
              <>
                {messages.map((msg, i) => (
                  <ChatMessage key={i} msg={msg} />
                ))}
                {loading && (
                  <div className="flex justify-start mb-4">
                    <div
                      className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center mr-2"
                      style={{ background: "rgba(98,224,216,0.15)" }}
                    >
                      <IconSparkles size={14} style={{ color: "#62E0D8" }} />
                    </div>
                    <div
                      className="rounded-xl px-4 py-3 text-sm"
                      style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
                    >
                      <span className="animate-pulse" style={{ color: "rgba(255,255,255,0.4)" }}>
                        Escribiendo...
                      </span>
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </>
            )}
          </div>

          {/* Input del chat (solo después de la primera generación) */}
          {formSubmitted && (
            <div
              className="shrink-0 px-6 py-4"
              style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}
            >
              <form onSubmit={handleChatSend} className="flex gap-3">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Pide ajustes, variaciones, otro tono…"
                  disabled={loading}
                  className="flex-1 rounded-xl px-4 py-2.5 text-sm outline-none placeholder:opacity-30"
                  style={{
                    background: "rgba(255,255,255,0.06)",
                    border:     "1px solid rgba(255,255,255,0.1)",
                    color:      "rgba(255,255,255,0.9)",
                  }}
                />
                <button
                  type="submit"
                  disabled={!input.trim() || loading}
                  className="px-4 rounded-xl transition hover:opacity-80 disabled:opacity-30"
                  style={{ background: "#62E0D8", color: "#0f0a2e" }}
                >
                  <IconSend size={16} />
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
