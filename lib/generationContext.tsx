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
  error?: string;
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
  resetGeneration: () => void;
};

// ─── Estado inicial ────────────────────────────────────────────────────────────

const INITIAL_STATE: Omit<GenerationState, "startGeneration" | "resetGeneration"> = {
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
  const [state, setState] = useState<Omit<GenerationState, "startGeneration" | "resetGeneration">>(INITIAL_STATE);

  // Ref para prevenir que múltiples loops corran en paralelo
  const isRunningRef = useRef(false);

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

    // Inicializar estado
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

    for (let i = 0; i < parsed.length; i++) {
      // Pausa de 3s entre contactos para no superar límites de rate
      if (i > 0) await new Promise((r) => setTimeout(r, 3000));

      try {
        const res = await fetch("/api/lemlist/csv-generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: clientId,
            contacts: [parsed[i]],
            segment_id: segmentId || undefined,
            use_deep_research: deepResearchSet.has(i),
          }),
        });

        if (res.ok) {
          const { results } = await res.json();
          if (results?.[0]) updated[i] = { ...updated[i], ...results[0] };
        } else {
          errCount++;
          updated[i] = { ...updated[i], error: `Error ${res.status}` };
        }
      } catch {
        errCount++;
        updated[i] = { ...updated[i], error: "Error de red" };
      }

      // Actualizar estado tras cada contacto usando copia del array
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

    isRunningRef.current = false;
    setState((prev) => ({ ...prev, isGenerating: false, stage: "done" }));
  }, []);

  const resetGeneration = useCallback(() => {
    isRunningRef.current = false;
    setState(INITIAL_STATE);
  }, []);

  const value: GenerationState = {
    ...state,
    startGeneration,
    resetGeneration,
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
