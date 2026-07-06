"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useClient } from "@/lib/clientContext";
import { IconArrowLeft, IconCheck, IconCopy, IconLoader2, IconAlertCircle } from "@tabler/icons-react";

type IndustryRecs = {
  id: string;
  name: string;
  job_title_chips: string[];
  headcount_bands: string[];
  industries: string[];
  locations: string[];
  keywords: string[];
};

function CopyChip({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border transition-colors"
      style={copied
        ? { background: "rgba(98,224,216,0.15)", borderColor: "#62E0D8", color: "#16a34a" }
        : { background: "#fff", borderColor: "#E5E2F0", color: "#251762" }}
    >
      {copied ? <IconCheck size={11} /> : <IconCopy size={11} />}
      {text}
    </button>
  );
}

function ListName({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <code className="px-1.5 py-0.5 rounded bg-[#F1EEF7] text-ink font-medium">{children}</code>
      <CopyChip text={children} />
    </span>
  );
}

export default function InstruccionesPage() {
  const { currentClient } = useClient();
  const [clienteNombre, setClienteNombre] = useState("");
  const [sdrNombre, setSdrNombre] = useState("");
  const [recs, setRecs] = useState<IndustryRecs[] | null>(null);
  const [loadingRecs, setLoadingRecs] = useState(false);
  const [recsError, setRecsError] = useState<string | null>(null);

  useEffect(() => {
    if (currentClient?.name && !clienteNombre) setClienteNombre(currentClient.name);
    const saved = localStorage.getItem("bullseye_sdr_name");
    if (saved) setSdrNombre(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentClient]);

  useEffect(() => {
    if (sdrNombre) localStorage.setItem("bullseye_sdr_name", sdrNombre);
  }, [sdrNombre]);

  useEffect(() => {
    if (!currentClient || currentClient.id === "__all__") return;
    setLoadingRecs(true);
    setRecsError(null);
    fetch(`/api/busqueda-manual/icp-roles?client_id=${currentClient.id}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) setRecsError(json.error);
        else setRecs(json.industries ?? []);
      })
      .catch(() => setRecsError("Error de red al cargar el ICP"))
      .finally(() => setLoadingRecs(false));
  }, [currentClient]);

  const cliente = clienteNombre.trim() || "{cliente}";
  const sdr = sdrNombre.trim() || "{SDR}";

  const leadsNoProspectar = `No prospectar - ${cliente} - ${sdr}`;
  const leadsYaProspectado = `Ya prospectado - ${cliente} - ${sdr}`;
  const accountsNoFit = `Empresas NO fit - ${cliente} - ${sdr}`;
  const accountsFit = `Empresas Fit - ${cliente} - ${sdr}`;
  const savedLeadsSearch = `Leads - ${cliente} - ${sdr}`;
  const savedAccountsSearch = `Empresas - ${cliente} - ${sdr}`;

  return (
    <div className="space-y-6 max-w-3xl">
      <Link href="/busqueda-manual" className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
        <IconArrowLeft size={15} /> Volver a búsqueda manual
      </Link>

      <header>
        <div className="label">Prospección</div>
        <h1 className="text-2xl font-semibold tracking-tight">Cómo prospectar en Sales Navigator</h1>
        <div className="text-sm text-ink-muted mt-1">
          Guía paso a paso para armar tus listas y búsquedas guardadas antes de importar a la app.
        </div>
      </header>

      <div className="card flex flex-wrap gap-4">
        <div>
          <label className="label block mb-1">Cliente</label>
          <input
            value={clienteNombre}
            onChange={(e) => setClienteNombre(e.target.value)}
            placeholder="Nombre del cliente"
            className="rounded-md border border-[#D8D5EA] px-2.5 py-1.5 text-sm w-56"
          />
        </div>
        <div>
          <label className="label block mb-1">Tu nombre (SDR)</label>
          <input
            value={sdrNombre}
            onChange={(e) => setSdrNombre(e.target.value)}
            placeholder="Tu nombre"
            className="rounded-md border border-[#D8D5EA] px-2.5 py-1.5 text-sm w-56"
          />
        </div>
      </div>

      <section className="card space-y-3">
        <h2 className="text-lg font-semibold">Setup inicial (una vez por cliente + SDR)</h2>
        <ol className="space-y-3 text-sm">
          <li><strong>1.</strong> Creá 2 listas de <strong>leads</strong> en Sales Navigator: <ListName>{leadsNoProspectar}</ListName> y <ListName>{leadsYaProspectado}</ListName>.</li>
          <li><strong>2.</strong> Creá 2 listas de <strong>accounts</strong>: <ListName>{accountsNoFit}</ListName> y <ListName>{accountsFit}</ListName>.</li>
          <li>
            <strong>3.</strong> Creá una <strong>búsqueda de leads</strong> filtrada por <em>Current Job Title</em> con los cargos del ICP (chips abajo, uno por uno). En <em>Account list</em> incluí <ListName>{accountsFit}</ListName>; en <em>Lead list</em> excluí <ListName>{leadsNoProspectar}</ListName> y <ListName>{leadsYaProspectado}</ListName>.
          </li>
          <li><strong>4.</strong> Guardala con "Save search to get notified of new results" como <ListName>{savedLeadsSearch}</ListName>.</li>
          <li>
            <strong>5.</strong> Creá una <strong>búsqueda de accounts</strong> con los filtros del ICP (recomendados abajo). En <em>Account lists</em> excluí <ListName>{accountsNoFit}</ListName> y <ListName>{accountsFit}</ListName>.
          </li>
          <li><strong>6.</strong> Guardala como <ListName>{savedAccountsSearch}</ListName>.</li>
        </ol>
      </section>

      <section className="card space-y-3">
        <h2 className="text-lg font-semibold">Prospección día a día</h2>
        <ol className="space-y-3 text-sm" start={7}>
          <li><strong>7.</strong> Recorré la búsqueda de accounts: las <strong>fit</strong> a <ListName>{accountsFit}</ListName>, las <strong>no fit</strong> a <ListName>{accountsNoFit}</ListName>.</li>
          <li><strong>8.</strong> En la búsqueda guardada de leads, "Add to Lemlist" (cuidando la cuenta de Lemlist del cliente correcto) → agregalos a la <strong>Campaña puente</strong> marcando enriquecer LinkedIn + email.</li>
          <li><strong>9.</strong> Antes de desmarcarlos: agregalos a <ListName>{leadsYaProspectado}</ListName>; si alguno no era fit, a <ListName>{leadsNoProspectar}</ListName>.</li>
          <li><strong>10.</strong> Volvé a la app → <Link href="/busqueda-manual" className="text-brand hover:underline">Importar desde Lemlist</Link> → generá los mensajes con IA y enviá a la campaña real.</li>
        </ol>
      </section>

      <section className="card space-y-3">
        <h2 className="text-lg font-semibold">Cargos para copiar y pegar (Current Job Title)</h2>
        <p className="text-sm text-ink-muted">Sacados del ICP del cliente activo. Pegalos uno por uno en el filtro de Sales Nav.</p>
        {!currentClient || currentClient.id === "__all__" ? (
          <p className="text-sm text-ink-muted">Seleccioná un cliente en el sidebar para ver sus cargos.</p>
        ) : loadingRecs ? (
          <div className="flex items-center gap-2 text-ink-muted text-sm"><IconLoader2 size={16} className="animate-spin" /> Cargando ICP…</div>
        ) : recsError ? (
          <div className="flex items-center gap-2 text-sm text-danger-fg"><IconAlertCircle size={15} /> {recsError}</div>
        ) : !recs?.length ? (
          <p className="text-sm text-ink-muted">Este cliente todavía no tiene ICP por industria configurado en /configuracion/icp.</p>
        ) : (
          recs.map((ind) => (
            <div key={ind.id} className="space-y-4 pt-2 first:pt-0">
              {recs.length > 1 && <div className="text-xs font-semibold text-ink-muted uppercase tracking-wide">{ind.name}</div>}
              <div>
                <div className="label mb-1.5">Cargos objetivo</div>
                <div className="flex flex-wrap gap-1.5">
                  {ind.job_title_chips.length ? ind.job_title_chips.map((c) => <CopyChip key={c} text={c} />) : <span className="text-xs text-ink-muted">Sin cargos definidos en el ICP.</span>}
                </div>
              </div>

              <div>
                <div className="label mb-1.5">Filtros de accounts recomendados</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <FilterBlock label="Company headcount" values={ind.headcount_bands} />
                  <FilterBlock label="Industry" values={ind.industries} />
                  <FilterBlock label="Headquarters location" values={ind.locations} />
                  <FilterBlock label="Keywords" values={ind.keywords} />
                </div>
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

function FilterBlock({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="rounded-lg border border-[#E5E2F0] p-2.5">
      <div className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1.5">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {values.length ? values.map((v) => <CopyChip key={v} text={v} />) : <span className="text-xs text-ink-muted">—</span>}
      </div>
    </div>
  );
}
