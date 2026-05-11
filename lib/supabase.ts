import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _admin: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (_admin) return _admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase env vars missing. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"
    );
  }
  _admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input as RequestInfo, { ...(init ?? {}), cache: "no-store" })
    }
  });
  return _admin;
}

export type IcpConfig = {
  id: string;
  version: number;
  is_active: boolean;
  org_types: OrgType[];
  signals_strong: string[];
  signals_medium: string[];
  signals_weak: string[];
  size_rules: SizeRule[];
  pipeline_mix: PipelineMix[];
  competitors: Competitor[];
  geographies: Geography[];
  notes: string;
  created_by: string | null;
  created_at: string;
};

export type OrgType    = { key: string; label: string; accept: boolean; note?: string };
export type SizeRule   = { min: number; max: number | null; decision: "approve" | "reject"; note?: string };
export type PipelineMix = { label: string; share: number; velocity: string };
export type Competitor = { name: string; note?: string };
export type Geography  = { region: string; priority: string; note?: string };

export type Contact = {
  id: string;
  company_id: string;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  linkedin_headline: string | null;
  linkedin_url: string | null;
  email: string | null;
  phone: string | null;
  seniority: string | null;
  tenure: string | null;
  prefilter_result: "yes" | "no" | null;
  prefilter_reason: string | null;
  fit_score: number | null;
  fit: string | null;
  fit_reason: string | null;
  fit_action: "enrich" | "manual_review" | "discard" | null;
  linkedin_icebreaker: string | null;
  email_subject: string | null;
  email_body: string | null;
  status: "pending" | "enriched" | "contacted" | "replied" | "discarded";
  clay_row_id: string | null;
  lemlist_lead_id: string | null;
  hubspot_contact_id: string | null;
  created_at: string;
  updated_at: string;
};

export type Company = {
  id: string;
  company_name: string;
  company_website: string | null;
  company_linkedin_url: string | null;
  company_city: string | null;
  company_country: string | null;
  company_size: number | null;
  company_type: "lab" | "multi_clinic" | "dso" | "other" | null;
  cad_software: string | null;
  scanner_technology: string | null;
  fit_signals: string | null;
  fit_score: "high" | "medium" | "low" | null;
  research_summary: string | null;
  research_sources: Array<{ title: string; url: string }>;
  competitor_match: string | null;
  status: "pending" | "approved" | "rejected";
  reject_reason: string | null;
  approved_by: string | null;
  approved_at: string | null;
  icp_version: number | null;
  created_at: string;
  updated_at: string;
};
