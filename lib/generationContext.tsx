"use client";

import React, { createContext, useCallback, useContext, useRef, useState } from "react";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type ParsedContact = {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  jobTitle?: string;
  companyName?: string;
  linkedinUrl?: string;
  industry?: string;
};

export type GeneratedContact = ParsedContact & {
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
  icpWarning?: boolean;
  deepResearchUsed?: boolean;
  error?: string;
  cancelled?: boolean;
  pushed?: boolean; // ya fue enviado a Lemlist
};

type GenerationStage = "idle" | "generating" | "done";

type GenerationState = {
  isGenerating: boolean;
  contacts: GeneratedContact[];
  genProgress: number;
  genErrors: number;
  clientId: string;
  segmentId: string;
  deepResearchSet: Set<number>;
  stage: GenerationStage;
  groupId: string | null;
  selectedCampaignId: string; // persiste al navegar
  startGeneration: (params: {
    clientId: string;
    parsed: ParsedContact[];
    segmentId: string;
    deepResearchSet: Set<number>;
    segmentName?: string;
    clientName?: string;
  }) => void;
  setSelectedCampaignId: (id: string) => void;
  cancelContact: (index: number) => void;
  cancelAll: () => void;
  resetGeneration: () => void;
  updateContact: (index: number, fields: Partial<GeneratedContact>) => void;
  resumePending: () => void;
  resumeGroup: (groupId: string, clientId: string, segmentId: string) => Promise<void>;
};

// ─── Estado inicial ────────────────────────────────────────────────────────────

const INITIAL_STATE: Omit<GenerationState, "startGeneration" | "setSelectedCampaignId" | "cancelContact" | "cancelAll" | "resetGeneration" | "updateContact" | "resumePending" | "resumeGroup"> = {
  isGenerating: false,
  stage: "idle",
  contacts: [],
  genProgress: 0,
  genErrors: 0,
  clientId: "",
  segmentId: "",
  deepResearchSet: new Set(),
  groupId: null,
  selectedCampaignId: "",
};

// ─── Contexto ─────────────────────────────────────────────────────────────────

const GenerationContext = createContext<GenerationState | null>(null);

export function GenerationProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<Omit<GenerationState, "startGeneration" | "cancelContact" | "cancelAll" | "resetGeneration" | "updateContact">>(INITIAL_STATE);

  const isRunningRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const skippedRef = useRef<Set<number>>(new Set());
  const groupIdRef = useRef<string | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state; // siempre apunta al estado actual

  // Guarda un contacto en el grupo persistente (fire-and-forget)
  function persistContact(groupId: string, index: number, contact: GeneratedContact, statusOverride?: string) {
    fetch(`/api/message-groups/${groupId}/contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contact_index: index,
        ...contact,
        status: statusOverride ?? (contact.cancelled ? "cancelled" : contact.error ? "error" : "generated"),
      }),
    }).catch(() => { /* silencioso */ });
  }

  const startGeneration = useCallback(async ({
    clientId,
    parsed,
    segmentId,
    deepResearchSet,
    segmentName,
    clientName,
  }: {
    clientId: string;
    parsed: ParsedContact[];
    segmentId: string;
    deepResearchSet: Set<number>;
    segmentName?: string;
    clientName?: string;
  }) => {
    if (isRunningRef.current) return;
    isRunningRef.current = true;
    skippedRef.current = new Set();

    // Crear grupo persistente en Supabase
    let groupId: string | null = null;
    try {
      const now = new Date();
      const dateStr = now.toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" });
      const autoName = [clientName, segmentName, dateStr].filter(Boolean).join(" · ");
      const res = await fetch("/api/message-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id:         clientId,
          name:              autoName,
          segment_id:        segmentId || null,
          segment_name:      segmentName || null,
          use_deep_research: deepResearchSet.size > 0,
          total_contacts:    parsed.length,
        }),
      });
      if (res.ok) {
        const grp = await res.json();
        groupId = grp.id;
        groupIdRef.current = groupId;
        // Pre-poblar todos los contactos como "pending" para poder reanudar si se interrumpe
        parsed.forEach((contact, i) => persistContact(groupId!, i, { ...contact }, "pending"));
      }
    } catch { /* si falla la creación del grupo, la generación continúa igual */ }

    setState({
      isGenerating: true,
      stage: "generating",
      genProgress: 0,
      genErrors: 0,
      contacts: parsed.map((c) => ({ ...c })),
      clientId,
      segmentId,
      deepResearchSet,
      groupId,
    });

    const updated: GeneratedContact[] = parsed.map((c) => ({ ...c }));
    let errCount = 0;
    let aborted = false;

    for (let i = 0; i < parsed.length; i++) {
      // Verificar abort/cancelación antes de cada contacto (sin timer — el fetch mismo demora ~15s)
      if (aborted || abortControllerRef.current?.signal.aborted) {
        aborted = true;
        updated[i] = { ...updated[i], cancelled: true, error: "Cancelado" };
        if (groupId) persistContact(groupId, i, updated[i]);
        continue;
      }

      if (skippedRef.current.has(i)) {
        updated[i] = { ...updated[i], cancelled: true, error: "Cancelado" };
        const snap = [...updated];
        setState((prev) => ({ ...prev, contacts: snap, genProgress: i + 1 }));
        if (groupId) persistContact(groupId, i, updated[i]);
        continue;
      }

      const ac = new AbortController();
      abortControllerRef.current = ac;

      const MAX_RETRIES = 2;
      let lastError = "";
      let success = false;

      for (let attempt = 0; attempt <= MAX_RETRIES && !success && !aborted; attempt++) {
        try {
          if (attempt > 0) await new Promise((r) => setTimeout(r, 1500 * attempt));
          const res = await fetch("/api/lemlist/csv-generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              client_id:         clientId,
              contacts:          [parsed[i]],
              segment_id:        segmentId || undefined,
              use_deep_research: deepResearchSet.has(i),
            }),
            signal: ac.signal,
          });

          if (res.ok) {
            const { results } = await res.json();
            if (results?.[0]) updated[i] = { ...updated[i], ...results[0] };
            success = true;
          } else {
            lastError = `Error ${res.status}`;
          }
        } catch (err: unknown) {
          if (err instanceof Error && err.name === "AbortError") {
            aborted = true;
            updated[i] = { ...updated[i], cancelled: true, error: "Cancelado" };
            break;
          }
          lastError = "Error de red";
        }
      }

      if (!success && !aborted) {
        errCount++;
        updated[i] = { ...updated[i], error: lastError };
      }

      // Persistir resultado en Supabase
      if (groupId) persistContact(groupId, i, updated[i]);

      const snapshot = [...updated];
      setState((prev) => ({
        ...prev,
        contacts: snapshot,
        genProgress: i + 1,
        genErrors: errCount,
      }));
    }

    abortControllerRef.current = null;
    isRunningRef.current = false;
    setState((prev) => ({ ...prev, isGenerating: false, stage: "done" }));
  }, []);

  const cancelContact = useCallback((index: number) => {
    skippedRef.current.add(index);
    setState((prev) => {
      const contacts = [...prev.contacts];
      contacts[index] = { ...contacts[index], cancelled: true, error: "Cancelado" };
      return { ...prev, contacts };
    });
  }, []);

  const cancelAll = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const resetGeneration = useCallback(() => {
    abortControllerRef.current?.abort();
    isRunningRef.current = false;
    skippedRef.current = new Set();
    groupIdRef.current = null;
    setState(INITIAL_STATE);
  }, []);

  // Cargar un grupo guardado desde la DB y preparar para reanudar los pendientes
  const resumeGroup = useCallback(async (groupId: string, clientId: string, segmentId: string) => {
    if (isRunningRef.current) return;

    const res = await fetch(`/api/message-groups/${groupId}/contacts`);
    if (!res.ok) return;
    const rows: any[] = await res.json();

    // Mapear filas de DB al formato GeneratedContact
    const contacts: GeneratedContact[] = rows.map((row) => ({
      firstName:        row.first_name    ?? "",
      lastName:         row.last_name     ?? "",
      email:            row.email         ?? "",
      phone:            row.phone         ?? undefined,
      jobTitle:         row.job_title     ?? undefined,
      companyName:      row.company_name  ?? undefined,
      linkedinUrl:      row.linkedin_url  ?? undefined,
      industry:         row.industry      ?? undefined,
      companySize:      row.company_size  ?? undefined,
      emailSubject:     row.email_subject   ?? undefined,
      emailBody:        row.email_body      ?? undefined,
      emailSubject2:    row.email_subject_2 ?? undefined,
      emailBody2:       row.email_body_2    ?? undefined,
      emailSubject3:    row.email_subject_3 ?? undefined,
      emailBody3:       row.email_body_3    ?? undefined,
      connectMessage:   row.connect_message ?? undefined,
      icebreaker:       row.icebreaker      ?? undefined,
      linkedinMsg2:     row.linkedin_msg_2  ?? undefined,
      segmentName:      row.segment_name    ?? undefined,
      deepResearchUsed: row.deep_research_used ?? undefined,
      icpWarning:       row.icp_warning      ?? undefined,
      error:     row.status === "error"     ? (row.error_message ?? "Error previo") : undefined,
      cancelled: row.status === "cancelled" ? true : undefined,
      pushed:    row.status === "sent"      ? true : undefined,
    }));

    const generatedCount = contacts.filter((c) => c.emailSubject || c.connectMessage).length;

    groupIdRef.current = groupId;
    setState({
      isGenerating:      false,
      stage:             "done",
      contacts,
      genProgress:       generatedCount,
      genErrors:         rows.filter((r) => r.status === "error").length,
      clientId,
      segmentId,
      deepResearchSet:   new Set(),
      groupId,
      selectedCampaignId: "",
    });
  }, []);

  // Retomar generación para contactos que quedaron sin generar (error no-cancelado o sin emailSubject/connectMessage)
  const resumePending = useCallback(async () => {
    if (isRunningRef.current) return;

    const snapshot = stateRef.current;
    if (!snapshot || !snapshot.clientId) return;

    const { contacts, clientId, segmentId, deepResearchSet, groupId } = snapshot;

    // Índices pendientes: tienen error (no cancelados) o nunca se generaron
    const pendingIndexes = contacts
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => !c.cancelled && !c.emailSubject && !c.connectMessage)
      .map(({ i }) => i);

    if (pendingIndexes.length === 0) return;

    isRunningRef.current = true;
    abortControllerRef.current = null;
    skippedRef.current = new Set();

    setState((prev) => ({
      ...prev,
      isGenerating: true,
      stage: "generating",
      genErrors: 0,
    }));

    const updated = [...contacts];
    let errCount = 0;
    let aborted = false;

    for (const i of pendingIndexes) {
      if (aborted || abortControllerRef.current?.signal.aborted) {
        aborted = true;
        updated[i] = { ...updated[i], cancelled: true, error: "Cancelado" };
        if (groupId) persistContact(groupId, i, updated[i]);
        const snap = [...updated];
        setState((prev) => ({ ...prev, contacts: snap }));
        continue;
      }

      if (skippedRef.current.has(i)) {
        updated[i] = { ...updated[i], cancelled: true, error: "Cancelado" };
        const snap = [...updated];
        setState((prev) => ({ ...prev, contacts: snap }));
        if (groupId) persistContact(groupId, i, updated[i]);
        continue;
      }

      // Limpiar error anterior para mostrar spinner
      updated[i] = { ...updated[i], error: undefined, cancelled: undefined };
      setState((prev) => ({ ...prev, contacts: [...updated] }));

      const ac = new AbortController();
      abortControllerRef.current = ac;

      let success = false;
      let lastError = "";

      for (let attempt = 0; attempt <= 2 && !success && !aborted; attempt++) {
        try {
          if (attempt > 0) await new Promise((r) => setTimeout(r, 1500 * attempt));
          const res = await fetch("/api/lemlist/csv-generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              client_id:         clientId,
              contacts:          [updated[i]],
              segment_id:        segmentId || undefined,
              use_deep_research: deepResearchSet.has(i),
            }),
            signal: ac.signal,
          });
          if (res.ok) {
            const { results } = await res.json();
            if (results?.[0]) updated[i] = { ...updated[i], ...results[0] };
            success = true;
          } else {
            lastError = `Error ${res.status}`;
          }
        } catch (err: unknown) {
          if (err instanceof Error && err.name === "AbortError") { aborted = true; break; }
          lastError = "Error de red";
        }
      }

      if (!success && !aborted) {
        errCount++;
        updated[i] = { ...updated[i], error: lastError };
      }

      if (groupId) persistContact(groupId, i, updated[i]);
      setState((prev) => ({ ...prev, contacts: [...updated], genErrors: errCount }));
    }

    abortControllerRef.current = null;
    isRunningRef.current = false;
    setState((prev) => ({ ...prev, isGenerating: false, stage: "done" }));
  }, []);

  const setSelectedCampaignId = useCallback((id: string) => {
    setState((prev) => ({ ...prev, selectedCampaignId: id }));
  }, []);

  const updateContact = useCallback((index: number, fields: Partial<GeneratedContact>) => {
    setState((prev) => {
      const next = [...prev.contacts];
      if (next[index]) next[index] = { ...next[index], ...fields };
      // Persistir edición en Supabase si hay grupo activo
      if (groupIdRef.current && next[index]) {
        persistContact(groupIdRef.current, index, next[index]);
      }
      return { ...prev, contacts: next };
    });
  }, []);

  const value: GenerationState = {
    ...state,
    startGeneration,
    setSelectedCampaignId,
    cancelContact,
    cancelAll,
    resetGeneration,
    updateContact,
    resumePending,
    resumeGroup,
  };

  return (
    <GenerationContext.Provider value={value}>
      {children}
    </GenerationContext.Provider>
  );
}

export function useGeneration(): GenerationState {
  const ctx = useContext(GenerationContext);
  if (!ctx) throw new Error("useGeneration debe usarse dentro de GenerationProvider");
  return ctx;
}
