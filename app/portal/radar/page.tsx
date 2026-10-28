"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { IconLoader2, IconActivityHeartbeat } from "@tabler/icons-react";
import RadarReport from "@/components/radar/RadarReport";
import { PARTS, PART_SLUGS, partIndex } from "@/lib/radarAbm/render";
import WishlistWorkspace from "@/components/wishlist/WishlistWorkspace";
import IcpPanel from "@/components/radar/IcpPanel";
import FeedbackPanel from "@/components/radar/FeedbackPanel";
import { DEFAULT_CONFIG } from "@/lib/radarAbm/dictionaries";
import type { RadarConfig, RadarDataset } from "@/lib/radarAbm/types";

// Pulso ABM del cliente en su portal. La vista va en ?vista=<slug> (el
// sidebar del portal lista las partes del informe). Los datos vienen de
// /api/portal/radar, que toma el cliente de la sesión: cada usuario ve solo
// su cuenta.

const STANDALONE: Record<string, () => JSX.Element> = {
  "cuentas-objetivo": () => <WishlistWorkspace />,
  "icp-proyecto": () => <IcpPanel audience="portal" />,
  "feedback-comercial": () => <FeedbackPanel audience="portal" />,
};

type Resp = { dataset: RadarDataset | null; config?: RadarConfig; reason?: "pending" | "disabled"; error?: string };

export default function PortalRadarPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const view = partIndex(params?.get("vista"));
  const slug = PART_SLUGS[view];
  const [data, setData] = useState<Resp | null>(null);

  useEffect(() => {
    fetch("/api/portal/radar", { cache: "no-store" })
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as Resp;
        setData(r.ok ? j : { dataset: null, error: j.error ?? "No se pudo cargar el informe" });
      })
      .catch(() => setData({ dataset: null, error: "No se pudo cargar el informe" }));
  }, []);

  if (!data) {
    return <div className="flex items-center gap-2 text-sm text-gray-500"><IconLoader2 size={16} className="animate-spin" /> Cargando informe…</div>;
  }
  // Sin informe (aún no sincronizado o deshabilitado): la wishlist, el ICP y
  // el feedback siguen disponibles porque no dependen de él
  if (!data.dataset && STANDALONE[slug]) {
    const Panel = STANDALONE[slug];
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-1" style={{ color: "#251762" }}>{PARTS[view][1]}</h1>
        <div className="mt-5"><Panel /></div>
      </div>
    );
  }
  if (!data.dataset) {
    return (
      <div className="max-w-xl mx-auto mt-10 bg-white rounded-2xl border border-gray-100 p-8 text-center">
        <IconActivityHeartbeat size={32} className="mx-auto mb-3" style={{ color: "#62E0D8" }} />
        <h1 className="text-lg font-semibold mb-2" style={{ color: "#251762" }}>Pulso ABM</h1>
        <p className="text-sm text-gray-600">
          {data.error
            ? data.error
            : data.reason === "disabled"
              ? "El informe Pulso ABM no está habilitado para tu cuenta. Contacta a tu ejecutivo de BullsEye."
              : "Tu informe Pulso ABM se está preparando. Aparecerá aquí apenas se sincronice la información de tu cuenta."}
        </p>
      </div>
    );
  }

  return (
    <RadarReport
      dataset={data.dataset}
      config={data.config ?? DEFAULT_CONFIG}
      view={view}
      onView={(v) => router.push(`${pathname}?vista=${PART_SLUGS[v]}`, { scroll: false })}
      audience="portal"
    />
  );
}
