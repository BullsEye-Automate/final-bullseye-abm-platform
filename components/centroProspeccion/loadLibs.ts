// Librerías del Centro de prospección, cargadas desde cdnjs con las mismas
// versiones que usaba el artifact original (así no se agregan dependencias
// al package.json del portal).

const LIBS = [
  { global: "Chart", src: "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js" },
  { global: "ExcelJS", src: "https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js" },
  { global: "Papa", src: "https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js" },
] as const;

type W = Window & Record<string, unknown>;

function loadScript(src: string, global: string): Promise<void> {
  const w = window as unknown as W;
  if (w[global]) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-centro-lib="${global}"]`);
    const s = existing ?? document.createElement("script");
    const done = () => (w[global] ? resolve() : reject(new Error(`No se cargó ${global}`)));
    s.addEventListener("load", done, { once: true });
    s.addEventListener("error", () => reject(new Error(`No se pudo descargar ${global}`)), { once: true });
    if (!existing) {
      s.src = src;
      s.async = true;
      s.crossOrigin = "anonymous";
      s.dataset.centroLib = global;
      document.head.appendChild(s);
    }
  });
}

export async function loadCentroLibs(): Promise<{ Chart: unknown; ExcelJS: unknown; Papa: unknown }> {
  await Promise.all(LIBS.map((l) => loadScript(l.src, l.global)));
  const w = window as unknown as W;
  return { Chart: w.Chart, ExcelJS: w.ExcelJS, Papa: w.Papa };
}
