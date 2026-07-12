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
  startGeneration: (params: {
    clientId: string;
    parsed: ParsedContact[];
    segmentId: string;
    deepResearchSet: Set<number>;
    segmentName?: string;
    clientName?: string;
  }) => void;
  cancelContact: (index: number) => void;
  cancelAll: () => void;
  resetGeneration: () => void;
  updateContact: (index: number, fields: Partial<GeneratedContact>) => void;
};

// ─── Estado inicial ────────────────────────────────────────────────────────────

const INITIAL_STATE: Omit<GenerationState, "startGeneration" | "cancelContact" | "cancelAll" | "resetGeneration" | "updateContact"> = {
  isGenerating: false,
  stage: "idle",
  contacts: [],
  genProgress: 0,
  genErrors: 0,
  clientId: "",
  segmentId: "",
  deepResearchSet: new Set(),
  groupId: null,
};

// ─── Contexto ─────────────────────────────────────────────────────────────────

const GenerationContext = createContext<GenerationState | null>(null);

export function GenerationProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<Omit<GenerationState, "startGeneration" | "cancelContact" | "cancelAll" | "resetGeneration" | "updateContact">>(INITIAL_STATE);

  const isRunningRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const skippedRef = useRef<Set<number>>(new Set());
  const groupIdRef = useRef<string | null>(null);

  // Guarda un contacto generado en el grupo persistente (fire-and-forget)
  function persistContact(groupId: string, index: number, contact: GeneratedContact) {
    fetch(`/api/message-groups/${groupId}/contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contact_index:    index,
        ...contact,
        status: contact.cancelled ? "cancelled" : contact.error ? "error" : "generated",
      }),
    }).catch(() => { /* silencioso — no interrumpe la generación */ });
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
      if (aborted) {
        updated[i] = { ...updated[i], cancelled: true, error: "Cancelado" };
        if (groupId) persistContact(groupId, i, updated[i]);
        continue;
      }

      if (i > 0) {
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, 3000);
          const check = setInterval(() => {
            if (abortControllerRef.current?.signal.aborted) {
              clearTimeout(t); clearInterval(check); resolve();
            }
          }, 100);
          abortControllerRef.current?.signal.addEventListener("abort", () => {
            clearTimeout(t); clearInterval(check); resolve();
          }, { once: true });
        });
      }

      if (abortControllerRef.current?.signal.aborted) {
        aborted = true;
        updated[i] = { ...updated[i], cancelled: true, error: "Cancelado" };
        const snap = [...updated];
        setState((prev) => ({ ...prev, contacts: snap, genProgress: i + 1 }));
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
    cancelContact,
    cancelAll,
    resetGeneration,
    updateContact,
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
