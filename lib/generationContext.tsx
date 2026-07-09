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
  startGeneration: (params: {
    clientId: string;
    parsed: ParsedContact[];
    segmentId: string;
    deepResearchSet: Set<number>;
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
};

// ─── Contexto ─────────────────────────────────────────────────────────────────

const GenerationContext = createContext<GenerationState | null>(null);

export function GenerationProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<Omit<GenerationState, "startGeneration" | "cancelContact" | "cancelAll" | "resetGeneration" | "updateContact">>(INITIAL_STATE);

  const isRunningRef = useRef(false);
  // AbortController activo para cancelar el fetch en curso
  const abortControllerRef = useRef<AbortController | null>(null);
  // Índices marcados para saltarse antes de procesarse
  const skippedRef = useRef<Set<number>>(new Set());

  const startGeneration = useCallback(async ({
    clientId,
    parsed,
    segmentId,
    deepResearchSet,
  }: {
    clientId: string;
    parsed: ParsedContact[];
    segmentId: string;
    deepResearchSet: Set<number>;
  }) => {
    if (isRunningRef.current) return;
    isRunningRef.current = true;
    skippedRef.current = new Set();

    setState({
      isGenerating: true,
      stage: "generating",
      genProgress: 0,
      genErrors: 0,
      contacts: parsed.map((c) => ({ ...c })),
      clientId,
      segmentId,
      deepResearchSet,
    });

    const updated: GeneratedContact[] = parsed.map((c) => ({ ...c }));
    let errCount = 0;
    let aborted = false;

    for (let i = 0; i < parsed.length; i++) {
      // Verificar cancelación total antes de esperar
      if (aborted) {
        updated[i] = { ...updated[i], cancelled: true, error: "Cancelado" };
        continue;
      }

      // Pausa de 3s entre contactos para no superar límites de rate
      if (i > 0) {
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, 3000);
          // Permitir que cancelAll interrumpa también el delay
          const check = setInterval(() => {
            if (abortControllerRef.current?.signal.aborted) {
              clearTimeout(t);
              clearInterval(check);
              resolve();
            }
          }, 100);
          abortControllerRef.current?.signal.addEventListener("abort", () => {
            clearTimeout(t);
            clearInterval(check);
            resolve();
          }, { once: true });
        });
      }

      // Re-verificar tras la pausa
      if (abortControllerRef.current?.signal.aborted) {
        aborted = true;
        updated[i] = { ...updated[i], cancelled: true, error: "Cancelado" };
        const snap = [...updated];
        setState((prev) => ({ ...prev, contacts: snap, genProgress: i + 1 }));
        continue;
      }

      // Contacto marcado individualmente para cancelar
      if (skippedRef.current.has(i)) {
        updated[i] = { ...updated[i], cancelled: true, error: "Cancelado" };
        const snap = [...updated];
        setState((prev) => ({ ...prev, contacts: snap, genProgress: i + 1 }));
        continue;
      }

      // Crear AbortController para este fetch
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
              client_id: clientId,
              contacts: [parsed[i]],
              segment_id: segmentId || undefined,
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

      const snapshot = [...updated];
      const progress = i + 1;
      const errors = errCount;
      setState((prev) => ({
        ...prev,
        contacts: snapshot,
        genProgress: progress,
        genErrors: errors,
      }));
    }

    abortControllerRef.current = null;
    isRunningRef.current = false;
    setState((prev) => ({ ...prev, isGenerating: false, stage: "done" }));
  }, []);

  // Cancela un contacto pendiente (aún no procesado)
  const cancelContact = useCallback((index: number) => {
    skippedRef.current.add(index);
    // Actualizar UI inmediatamente para quitar el spinner
    setState((prev) => {
      const contacts = [...prev.contacts];
      contacts[index] = { ...contacts[index], cancelled: true, error: "Cancelado" };
      return { ...prev, contacts };
    });
  }, []);

  // Cancela la generación completa
  const cancelAll = useCallback(() => {
    abortControllerRef.current?.abort();
    // Marcar todos los pendientes como cancelados en skippedRef
    // (el loop los procesará en la próxima iteración)
  }, []);

  const resetGeneration = useCallback(() => {
    abortControllerRef.current?.abort();
    isRunningRef.current = false;
    skippedRef.current = new Set();
    setState(INITIAL_STATE);
  }, []);

  const updateContact = useCallback((index: number, fields: Partial<GeneratedContact>) => {
    setState((prev) => {
      const next = [...prev.contacts];
      if (next[index]) next[index] = { ...next[index], ...fields };
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
