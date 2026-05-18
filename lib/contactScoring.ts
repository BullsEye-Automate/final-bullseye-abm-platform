// Scorer de fit para contactos que no pasaron por Clay's Lead Scoring AI
// (típicamente los que entraron por Sales Navigator, web scrape o manual
// import — bypasean Clay y quedan con fit_score=null).
//
// Usa los mismos criterios que el prompt de Lead Scoring de Clay:
//   - Decisor con autoridad en CAD/CAM + empresa fit alto → score 8-10
//   - Decisor en empresa fit medio → 5-7
//   - Role tangencial o influencer indirecto → 3-4
//   - Non-decision-maker o fuera de buyer persona → 1-2
//
// Devuelve { fit_score, fit, fit_reason, fit_action } con el mismo shape
// que el webhook scored-contacts de Clay, para que el contacto entre al
// mismo pipeline de aprobación.

import { createMessageWithFallback } from "./claude";
import type Anthropic from "@anthropic-ai/sdk";

export type ScoreInput = {
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  linkedin_headline: string | null;
  seniority: string | null;
  company_name: string | null;
  company_type: string | null;
  company_size: number | null;
  cad_software: string | null;
  scanner_technology: string | null;
  fit_signals: string | null;
};

export type ScoreResult = {
  fit_score: number; // 1-10
  fit: "yes" | "no" | "maybe";
  fit_reason: string;
  fit_action: "enrich" | "manual_review" | "discard";
  model_used: string;
};

const SYSTEM_PROMPT = `You are a Lead Scoring AI for weCAD4you, a B2B service that designs dental CAD/CAM restorations (crowns, bridges, veneers) from STL files in exocad and Siemens inLab. Customers are dental labs, multi-clinic groups, and DSOs.

You score contacts 1-10 based on fit for outreach:
  - Score 8-10: clear decision-maker in CAD/CAM at a fit company. Title shows ownership of production/CAD/CAM decisions (Lab Manager, Owner, CAD Manager, CTO, Director of Operations at a lab/DSO with digital CAD signals). Company has confirmed exocad/inLab OR strong digital indicators.
  - Score 5-7: decision-maker at a medium-fit company OR a role with influence over CAD/CAM but not direct ownership (CEO at small lab, CFO at lab, COO).
  - Score 3-4: tangentially related role (marketing, sales, IT at a dental org), OR a decision-maker at a low-fit company (no digital signals).
  - Score 1-2: non-decision-maker (assistant, intern, executive assistant, junior tech), wrong department, or person at non-dental company.

Map score to action:
  - 8-10 → enrich (auto-approve for outreach, the SDR will review and push)
  - 5-7 → manual_review (the human decides)
  - 1-4 → discard

Output strict JSON only:
{
  "fit_score": <1-10>,
  "fit": "yes" | "no" | "maybe",
  "fit_action": "enrich" | "manual_review" | "discard",
  "reason": "<1-2 short sentences in Spanish explaining the score>"
}

"fit" mirrors the action (yes=enrich, maybe=manual_review, no=discard).

Be strict: a "Marketing Manager" at a dental lab is NOT a CAD/CAM decision-maker. Score 2-3. A "CAD Technician" is a do-er, not a decision-maker. Score 4-5 unless their headline shows decision authority.`;

function buildUserPrompt(input: ScoreInput): string {
  const lines: string[] = [];
  lines.push(`Score this contact:`);
  lines.push(``);
  lines.push(`CONTACT:`);
  lines.push(`- Name: ${[input.first_name, input.last_name].filter(Boolean).join(" ") || "(unknown)"}`);
  lines.push(`- Job title: ${input.job_title ?? "(unknown)"}`);
  if (input.linkedin_headline) lines.push(`- LinkedIn headline: ${input.linkedin_headline}`);
  if (input.seniority) lines.push(`- Seniority: ${input.seniority}`);
  lines.push(``);
  lines.push(`COMPANY:`);
  lines.push(`- Name: ${input.company_name ?? "(unknown)"}`);
  if (input.company_type) lines.push(`- Type: ${input.company_type}`);
  if (input.company_size != null) lines.push(`- Size: ${input.company_size} employees`);
  lines.push(`- CAD software confirmed: ${input.cad_software ?? "(no public information)"}`);
  lines.push(`- Scanner technology: ${input.scanner_technology ?? "(no public information)"}`);
  if (input.fit_signals && input.fit_signals.trim()) {
    lines.push(`- Fit signals: ${input.fit_signals}`);
  } else {
    lines.push(`- Fit signals: (none confirmed)`);
  }
  lines.push(``);
  lines.push(`Respond with the JSON only.`);
  return lines.join("\n");
}

function extractJson(raw: string): any {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(body);
  } catch {
    const m = body.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function computeContactFitScore(input: ScoreInput): Promise<ScoreResult> {
  const { message, model_used } = await createMessageWithFallback({
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(input) }]
  });

  const block = message.content.find((c) => c.type === "text");
  if (!block || block.type !== "text") {
    throw new Error("Scorer: Claude returned no text block");
  }
  const parsed = extractJson(block.text) as
    | {
        fit_score?: number;
        fit?: string;
        fit_action?: string;
        reason?: string;
      }
    | null;
  if (!parsed) throw new Error("Scorer: invalid JSON from Claude");

  const fitScoreRaw = typeof parsed.fit_score === "number" ? parsed.fit_score : parseInt(String(parsed.fit_score ?? ""), 10);
  const fitScore = Number.isFinite(fitScoreRaw) ? Math.max(1, Math.min(10, Math.round(fitScoreRaw))) : 5;

  const actionRaw = String(parsed.fit_action ?? "").trim().toLowerCase();
  let action: ScoreResult["fit_action"];
  if (actionRaw === "enrich" || actionRaw === "manual_review" || actionRaw === "discard") {
    action = actionRaw as ScoreResult["fit_action"];
  } else if (fitScore >= 8) action = "enrich";
  else if (fitScore >= 5) action = "manual_review";
  else action = "discard";

  const fitRaw = String(parsed.fit ?? "").trim().toLowerCase();
  let fit: ScoreResult["fit"] = "maybe";
  if (fitRaw === "yes" || fitRaw === "no" || fitRaw === "maybe") fit = fitRaw as ScoreResult["fit"];
  else if (action === "enrich") fit = "yes";
  else if (action === "discard") fit = "no";

  return {
    fit_score: fitScore,
    fit,
    fit_reason: String(parsed.reason ?? "").trim() || `Score automático ${fitScore}/10.`,
    fit_action: action,
    model_used
  };
}
