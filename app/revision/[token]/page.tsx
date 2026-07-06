"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  IconMail,
  IconBrandLinkedin,
  IconLoader2,
  IconAlertCircle,
  IconBuilding,
  IconBriefcase,
  IconUser,
} from "@tabler/icons-react";

type Contact = {
  firstName: string;
  lastName: string;
  email?: string;
  jobTitle?: string;
  companyName?: string;
  emailSubject?: string;
  emailBody?: string;
  emailSubject2?: string;
  emailBody2?: string;
  emailSubject3?: string;
  emailBody3?: string;
  connectMessage?: string;
  icebreaker?: string;
  linkedinMsg2?: string;
  segmentName?: string;
};

type Session = {
  token: string;
  client_name: string | null;
  contacts: Contact[];
  created_at: string;
};

export default function RevisionPage() {
  const { token } = useParams<{ token: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/review-sessions/${token}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setSession(d);
      })
      .catch(() => setError("Error al cargar la sesión"))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8F6FC]">
        <div className="flex items-center gap-3 text-[#251762]">
          <IconLoader2 size={22} className="animate-spin" />
          <span className="font-medium">Cargando mensajes…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8F6FC]">
        <div className="bg-white rounded-2xl shadow-sm border border-[#E5E2F0] px-8 py-10 max-w-md text-center space-y-3">
          <IconAlertCircle size={36} className="mx-auto text-red-400" />
          <p className="font-semibold text-[#251762] text-lg">{error}</p>
          <p className="text-sm text-gray-500">Si crees que esto es un error, contacta a quien te compartió este link.</p>
        </div>
      </div>
    );
  }

  if (!session) return null;

  const date = new Date(session.created_at).toLocaleDateString("es", {
    day: "numeric", month: "long", year: "numeric",
  });

  return (
    <div className="min-h-screen bg-[#F8F6FC]">
      {/* Header */}
      <div style={{ background: "#251762" }} className="px-6 py-5">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div>
            <div className="text-[#62E0D8] text-xs font-semibold tracking-widest uppercase mb-1">
              Bulls<span style={{ color: "white" }}>Eye</span>
            </div>
            <h1 className="text-white font-semibold text-xl">
              Revisión de mensajes{session.client_name ? ` — ${session.client_name}` : ""}
            </h1>
            <p className="text-white/50 text-xs mt-0.5">{session.contacts.length} contacto{session.contacts.length !== 1 ? "s" : ""} · Generado el {date}</p>
          </div>
        </div>
      </div>

      {/* Contacts */}
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {session.contacts.map((c, i) => {
          const fullName = [c.firstName, c.lastName].filter(Boolean).join(" ") || "(sin nombre)";
          const emails = [
            { label: "Email 1", subject: c.emailSubject, body: c.emailBody },
            { label: "Email 2", subject: c.emailSubject2, body: c.emailBody2 },
            { label: "Email 3", subject: c.emailSubject3, body: c.emailBody3 },
          ].filter((e) => e.subject);

          const linkedinMsgs = [
            { label: "Mensaje de conexión", body: c.connectMessage },
            { label: "Mensaje 1", body: c.icebreaker },
            { label: "Mensaje 2", body: c.linkedinMsg2 },
          ].filter((m) => m.body);

          return (
            <div key={i} className="bg-white rounded-2xl shadow-sm border border-[#E5E2F0] overflow-hidden">
              {/* Contact header */}
              <div className="px-6 py-4 border-b border-[#F1EEF7]" style={{ background: "rgba(37,23,98,0.03)" }}>
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-white font-semibold text-sm"
                    style={{ background: "#251762" }}>
                    {(c.firstName?.[0] ?? "?").toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-[#251762] text-base">{fullName}</div>
                    <div className="flex items-center gap-3 flex-wrap mt-0.5">
                      {c.jobTitle && (
                        <span className="flex items-center gap-1 text-xs text-gray-500">
                          <IconBriefcase size={11} /> {c.jobTitle}
                        </span>
                      )}
                      {c.companyName && (
                        <span className="flex items-center gap-1 text-xs text-gray-500">
                          <IconBuilding size={11} /> {c.companyName}
                        </span>
                      )}
                      {c.segmentName && (
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{ background: "rgba(98,224,216,0.15)", color: "#0fa89a" }}>
                          {c.segmentName}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="px-6 py-5 space-y-6">
                {/* Emails */}
                {emails.length > 0 && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                      <IconMail size={13} /> Secuencia de email
                    </div>
                    {emails.map((e) => (
                      <div key={e.label} className="rounded-xl border border-[#E5E2F0] overflow-hidden">
                        <div className="px-4 py-2 border-b border-[#F1EEF7] bg-[#FAFAFA] flex items-center justify-between">
                          <span className="text-xs font-semibold text-gray-400">{e.label}</span>
                        </div>
                        <div className="px-4 py-3 space-y-2">
                          <div className="text-sm font-semibold text-[#251762]">{e.subject}</div>
                          <p className="text-sm text-gray-700 whitespace-pre-line leading-relaxed">{e.body}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* LinkedIn */}
                {linkedinMsgs.length > 0 && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                      <IconBrandLinkedin size={13} /> Secuencia LinkedIn
                    </div>
                    {linkedinMsgs.map((m) => (
                      <div key={m.label} className="rounded-xl border border-[#E5E2F0] overflow-hidden">
                        <div className="px-4 py-2 border-b border-[#F1EEF7] bg-[#FAFAFA]">
                          <span className="text-xs font-semibold text-gray-400">{m.label}</span>
                        </div>
                        <div className="px-4 py-3">
                          <p className="text-sm text-gray-700 whitespace-pre-line leading-relaxed">{m.body}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="max-w-3xl mx-auto px-4 pb-10 text-center text-xs text-gray-400">
        Este link expira 7 días después de su creación.
      </div>
    </div>
  );
}
