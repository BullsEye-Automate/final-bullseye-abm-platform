// Academia SDR: tipos compartidos entre servidor (generación con IA),
// página interna y render del HTML interactivo.

export type AcademyInputs = {
  focusService: string;   // servicio foco de la campaña
  countries: string;      // países de esta fase
  industries: string;     // industrias prioritarias (opcional)
  notes: string;          // indicaciones extra para la IA (opcional)
};

export const EMPTY_INPUTS: AcademyInputs = { focusService: "", countries: "", industries: "", notes: "" };

export function sanitizeInputs(raw: unknown): AcademyInputs {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  return {
    focusService: s(o.focusService, 500),
    countries: s(o.countries, 300),
    industries: s(o.industries, 500),
    notes: s(o.notes, 3000),
  };
}

// Bloques de contenido de un módulo. Cada tipo tiene su propio render
// (los interactivos: servicios, diccionario, casos, armador, objeciones,
// checklist y quiz).
export type Block =
  | { type: "text"; heading?: string; paragraphs: string[] }
  | { type: "bullets"; heading?: string; items: string[] }
  | { type: "callout"; heading?: string; text: string; tone?: "info" | "alerta" | "tip" }
  | { type: "concepts"; heading?: string; items: { term: string; simple: string; why: string }[] }
  | { type: "facts"; heading?: string; items: { label: string; value: string }[] }
  | { type: "story"; heading?: string; problem: string; solution: string; result: string; analogy?: string }
  | { type: "services"; heading?: string; services: { name: string; analogy: string; meaning: string; example: string; focus?: boolean }[] }
  | { type: "steps"; heading?: string; steps: { title: string; detail: string }[] }
  | { type: "glossary"; heading?: string; items: { term: string; simple: string; why: string }[] }
  | { type: "roles"; heading?: string; roles: { role: string; kind: "decide" | "influye" | "no_decide"; cares: string }[] }
  | { type: "needs"; heading?: string; needs: { segment: string; problem: string; phrases: string[] }[] }
  | { type: "cases"; heading?: string; cases: { industry: string; client: string; story: string; oneLiner: string }[] }
  | { type: "dosdonts"; heading?: string; dos: string[]; donts: string[] }
  | { type: "builder"; heading?: string; pieces: { context: string[]; help: string[]; proof: string[]; question: string[] } }
  | { type: "examples"; heading?: string; examples: { channel: string; title: string; text: string }[] }
  | { type: "script"; heading?: string; lines: { speaker: string; text: string }[] }
  | { type: "sequence"; heading?: string; steps: { day: string; channel: string; action: string }[] }
  | { type: "checklist"; heading?: string; items: { text: string; critical?: boolean }[] }
  | { type: "questions"; heading?: string; items: string[] }
  | { type: "objections"; heading?: string; objections: { objection: string; meaning: string; answer: string }[] }
  | { type: "plan"; heading?: string; days: { day: string; title: string; tasks: string[] }[] }
  | { type: "quiz"; heading?: string; questions: { q: string; options: string[]; answer: number; explain?: string }[] };

export type AcademyModule = {
  no: number;
  title: string;
  subtitle?: string;
  blocks: Block[];
  remember: string;
  openQuestions?: string[];   // datos a confirmar con el cliente
};

export type AcademyRecord = {
  clientName: string;
  inputs: AcademyInputs;
  modules: (AcademyModule | null)[]; // índice 0 = módulo 1
  generatedAt: string | null;
  generatedBy: string | null;
};
