"use client";

import { useState, useRef, useEffect } from "react";
import { IconSend, IconCopy, IconCheck, IconSparkles, IconRefresh, IconChevronDown } from "@tabler/icons-react";

type EmailType = "info" | "referral" | "cold";
type Message   = { role: "user" | "assistant"; content: string };

const EMAIL_TYPE_LABELS: Record<EmailType, string> = {
  info:     "Más información",
  referral: "Derivación / Referido",
  cold:     "Primer contacto",
};

type Client = { id: string; name: string };

function parseEmail(text: string): { subject: string; body: string } | null {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch {}
  return null;
}

function EmailCard({ subject, body }: { subject: string; body: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(`Asunto: ${subject}\n\n${body}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "#1a1040", border: "1px solid rgba(98,224,216,0.25)" }}>
      <div className="flex items-start justify-between gap-3 px-5 py-4" style={{ borderBottom: "1px solid rgba(98,224,216,0.12)" }}>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-widest mb-1 font-medium" style={{ color: "#62E0D8", opacity: 0.7 }}>Asunto</p>
          <p className="text-sm font-semibold text-white">{subject}</p>
        </div>
        <button
          onClick={copy}
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-opacity hover:opacity-70"
          style={{ background: "rgba(98,224,216,0.15)", color: "#62E0D8" }}
        >
          {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
          {copied ? "Copiado" : "Copiar"}
        </button>
      </div>
      <div className="px-5 py-4">
        <p className="text-[10px] uppercase tracking-widest mb-2 font-medium" style={{ color: "#62E0D8", opacity: 0.7 }}>Cuerpo</p>
        <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: "rgba(255,255,255,0.82)" }}>{body}</p>
      </div>
    </div>
  );
}

function Bubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  const parsed = !isUser ? parseEmail(msg.content) : null;

  return (
    <div className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"} mb-5`}>
      {!isUser && (
        <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center mt-0.5" style={{ background: "rgba(98,224,216,0.12)" }}>
          <IconSparkles size={15} style={{ color: "#62E0D8" }} />
        </div>
      )}
      <div className="max-w-[75%]">
        {parsed ? (
          <EmailCard subject={parsed.subject ?? ""} body={parsed.body ?? ""} />
        ) : (
          <div
            className="rounded-2xl px-4 py-3 text-sm leading-relaxed"
            style={
              isUser
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
  const [clients, setClients]         = useState<Client[]>([]);
  const [clientId, setClientId]           = useState("");
  const [emailType, setEmailType]         = useState<EmailType>("info");
  const [recipientName, setRecipientName] = useState("");
  const [recipientCompany, setRecipientCompany] = useState("");
  const [recipientTitle, setTitle]        = useState("");
  const [referrerName, setReferrer]       = useState("");
  const [contextNotes, setNotes]          = useState("");
  const [step, setStep]               = useState<"setup" | "chat">("setup");
  const [messages, setMessages]       = useState<Message[]>([]);
  const [input, setInput]             = useState("");
  const [loading, setLoading]         = useState(false);
  const [typeOpen, setTypeOpen]       = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/clients")
      .then((r) => r.json())
      .then(({ clients: data }) => setClients(data ?? []));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(userContent: string, isFirst = false) {
    setLoading(true);
    const newMsg: Message  = { role: "user", content: userContent };
    const updated = [...messages, newMsg];
    setMessages(updated);

    const res = await fetch("/api/agente-contenido", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId,
        messages: updated,
        emailType:        isFirst ? emailType        : undefined,
        recipientName:    isFirst ? recipientName    : undefined,
        recipientCompany: isFirst ? recipientCompany : undefined,
        recipientTitle:   isFirst ? recipientTitle   : undefined,
        referrerName:     isFirst && emailType === "referral" ? referrerName : undefined,
        contextNotes:     isFirst ? contextNotes     : undefined,
        save:             isFirst,
      }),
    });

    const data = await res.json();
    setMessages((prev) => [...prev, { role: "assistant", content: data.message ?? "Error al generar." }]);
    setLoading(false);
  }

  async function handleStart(e: React.FormEvent) {
    e.preventDefault();
    setStep("chat");
    await send("Genera el correo", true);
  }

  async function handleChat(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || loading) return;
    const text = input.trim();
    setInput("");
    await send(text, false);
  }

  function reset() {
    setMessages([]);
    setStep("setup");
    setInput("");
    setRecipientName("");
    setRecipientCompany("");
    setTitle("");
    setReferrer("");
    setNotes("");
  }

  const selectedClient = clients.find((c) => c.id === clientId);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4" style={{ background: "#0d0825" }}>
      <div
        className="w-full flex flex-col"
        style={{ maxWidth: 680, height: "calc(100vh - 2rem)", maxHeight: 840 }}
      >
        {/* Header */}
        <div
          className="shrink-0 flex items-center justify-between px-6 py-4 rounded-t-2xl"
          style={{ background: "#160e3a", borderBottom: "1px solid rgba(255,255,255,0.07)" }}
        >
          <div className="flex items-center gap-3">
            <div className="text-[18px] font-bold tracking-tight leading-none">
              <span className="text-white">Bulls</span>
              <span style={{ color: "#62E0D8" }}>Eye</span>
            </div>
            <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ background: "rgba(98,224,216,0.1)", color: "#62E0D8" }}>
              Agente de Contenido
            </span>
          </div>
          {step === "chat" && (
            <button
              onClick={reset}
              className="flex items-center gap-1.5 text-[12px] transition-opacity hover:opacity-60"
              style={{ color: "rgba(255,255,255,0.4)" }}
            >
              <IconRefresh size={13} /> Nuevo
            </button>
          )}
        </div>

        {/* Cuerpo */}
        <div
          className="flex-1 overflow-hidden flex flex-col"
          style={{ background: "#110c30", borderLeft: "1px solid rgba(255,255,255,0.06)", borderRight: "1px solid rgba(255,255,255,0.06)" }}
        >
          {step === "setup" ? (
            /* ── Formulario de contexto ── */
            <div className="flex-1 overflow-y-auto px-6 py-6">
              <p className="text-[13px] mb-6" style={{ color: "rgba(255,255,255,0.45)" }}>
                Configura el contexto del correo y el agente lo redacta por ti.
              </p>
              <form onSubmit={handleStart} className="space-y-5">
                {/* Cliente */}
                <div>
                  <label className="block text-[11px] uppercase tracking-widest font-medium mb-2" style={{ color: "rgba(255,255,255,0.4)" }}>
                    Cliente
                  </label>
                  <select
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    required
                    className="w-full rounded-xl px-4 py-2.5 text-sm outline-none appearance-none"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: clientId ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.3)" }}
                  >
                    <option value="">Seleccionar cliente...</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                {/* Tipo de correo — dropdown custom */}
                <div className="relative">
                  <label className="block text-[11px] uppercase tracking-widest font-medium mb-2" style={{ color: "rgba(255,255,255,0.4)" }}>
                    Tipo de correo
                  </label>
                  <button
                    type="button"
                    onClick={() => setTypeOpen((v) => !v)}
                    className="w-full flex items-center justify-between rounded-xl px-4 py-2.5 text-sm text-left"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.9)" }}
                  >
                    <span>{EMAIL_TYPE_LABELS[emailType]}</span>
                    <IconChevronDown size={14} style={{ opacity: 0.5, transform: typeOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s" }} />
                  </button>
                  {typeOpen && (
                    <div
                      className="absolute left-0 right-0 top-full mt-1 rounded-xl overflow-hidden z-20"
                      style={{ background: "#1e1450", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}
                    >
                      {(Object.entries(EMAIL_TYPE_LABELS) as [EmailType, string][]).map(([val, label]) => (
                        <button
                          type="button"
                          key={val}
                          onClick={() => { setEmailType(val); setTypeOpen(false); }}
                          className="w-full text-left px-4 py-2.5 text-sm transition hover:bg-white/10"
                          style={{ color: emailType === val ? "#62E0D8" : "rgba(255,255,255,0.8)" }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Nombre y empresa del destinatario */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] uppercase tracking-widest font-medium mb-2" style={{ color: "rgba(255,255,255,0.4)" }}>
                      Nombre
                    </label>
                    <input
                      type="text"
                      value={recipientName}
                      onChange={(e) => setRecipientName(e.target.value)}
                      placeholder="Ej: María González"
                      className="w-full rounded-xl px-4 py-2.5 text-sm outline-none placeholder:opacity-25"
                      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.9)" }}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] uppercase tracking-widest font-medium mb-2" style={{ color: "rgba(255,255,255,0.4)" }}>
                      Empresa
                    </label>
                    <input
                      type="text"
                      value={recipientCompany}
                      onChange={(e) => setRecipientCompany(e.target.value)}
                      placeholder="Ej: Clínica Norte"
                      className="w-full rounded-xl px-4 py-2.5 text-sm outline-none placeholder:opacity-25"
                      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.9)" }}
                    />
                  </div>
                </div>

                {/* Cargo */}
                <div>
                  <label className="block text-[11px] uppercase tracking-widest font-medium mb-2" style={{ color: "rgba(255,255,255,0.4)" }}>
                    Cargo del destinatario
                  </label>
                  <input
                    type="text"
                    value={recipientTitle}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Ej: Director de Operaciones"
                    className="w-full rounded-xl px-4 py-2.5 text-sm outline-none placeholder:opacity-25"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.9)" }}
                  />
                </div>

                {/* Derivación */}
                {emailType === "referral" && (
                  <div>
                    <label className="block text-[11px] uppercase tracking-widest font-medium mb-2" style={{ color: "rgba(255,255,255,0.4)" }}>
                      ¿Quién los derivó?
                    </label>
                    <input
                      type="text"
                      value={referrerName}
                      onChange={(e) => setReferrer(e.target.value)}
                      placeholder="Nombre de quien refirió"
                      className="w-full rounded-xl px-4 py-2.5 text-sm outline-none placeholder:opacity-25"
                      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.9)" }}
                    />
                  </div>
                )}

                {/* Notas */}
                <div>
                  <label className="block text-[11px] uppercase tracking-widest font-medium mb-2" style={{ color: "rgba(255,255,255,0.4)" }}>
                    Contexto adicional <span style={{ opacity: 0.5 }}>(opcional)</span>
                  </label>
                  <textarea
                    value={contextNotes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Ej: El prospecto mencionó que usan tecnología X..."
                    rows={3}
                    className="w-full rounded-xl px-4 py-2.5 text-sm outline-none resize-none placeholder:opacity-25"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.9)" }}
                  />
                </div>

                <button
                  type="submit"
                  disabled={!clientId}
                  className="w-full py-3 rounded-xl text-sm font-semibold transition hover:opacity-90 disabled:opacity-30 flex items-center justify-center gap-2"
                  style={{ background: "#62E0D8", color: "#0d0825" }}
                >
                  <IconSparkles size={15} />
                  Generar correo
                </button>
              </form>
            </div>
          ) : (
            /* ── Chat ── */
            <>
              {/* Info del contexto seleccionado */}
              <div
                className="shrink-0 flex items-center gap-3 px-5 py-2.5 text-[11px]"
                style={{ background: "rgba(98,224,216,0.05)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}
              >
                <span style={{ color: "rgba(255,255,255,0.4)" }}>Cliente:</span>
                <span style={{ color: "#62E0D8" }}>{selectedClient?.name}</span>
                <span className="mx-1" style={{ color: "rgba(255,255,255,0.15)" }}>·</span>
                <span style={{ color: "rgba(255,255,255,0.4)" }}>{EMAIL_TYPE_LABELS[emailType]}</span>
                {recipientName && (
                  <>
                    <span className="mx-1" style={{ color: "rgba(255,255,255,0.15)" }}>·</span>
                    <span style={{ color: "rgba(255,255,255,0.4)" }}>
                      {recipientName}{recipientCompany ? ` · ${recipientCompany}` : ""}
                    </span>
                  </>
                )}
                {recipientTitle && (
                  <>
                    <span className="mx-1" style={{ color: "rgba(255,255,255,0.15)" }}>·</span>
                    <span style={{ color: "rgba(255,255,255,0.4)" }}>{recipientTitle}</span>
                  </>
                )}
              </div>

              {/* Mensajes */}
              <div className="flex-1 overflow-y-auto px-5 py-5">
                {messages.map((msg, i) => <Bubble key={i} msg={msg} />)}
                {loading && (
                  <div className="flex gap-3 mb-5">
                    <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "rgba(98,224,216,0.12)" }}>
                      <IconSparkles size={15} style={{ color: "#62E0D8" }} />
                    </div>
                    <div className="rounded-2xl px-4 py-3 text-sm" style={{ background: "#1a1040", border: "1px solid rgba(255,255,255,0.07)" }}>
                      <span className="animate-pulse" style={{ color: "rgba(255,255,255,0.35)" }}>Escribiendo...</span>
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>

              {/* Input */}
              <div className="shrink-0 px-5 pb-5">
                <form onSubmit={handleChat} className="flex gap-2">
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Pide ajustes, variaciones, otro tono…"
                    disabled={loading}
                    className="flex-1 rounded-xl px-4 py-2.5 text-sm outline-none placeholder:opacity-25"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.9)" }}
                  />
                  <button
                    type="submit"
                    disabled={!input.trim() || loading}
                    className="px-4 rounded-xl transition hover:opacity-80 disabled:opacity-30"
                    style={{ background: "#62E0D8", color: "#0d0825" }}
                  >
                    <IconSend size={16} />
                  </button>
                </form>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div
          className="shrink-0 text-center py-3 rounded-b-2xl text-[11px]"
          style={{ background: "#160e3a", color: "rgba(255,255,255,0.2)", borderTop: "1px solid rgba(255,255,255,0.07)" }}
        >
          BullsEye — Agente de Contenido
        </div>
      </div>
    </div>
  );
}
