/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
    // Fuentes del PNG del Reporte SDR (se leen con fs en lib/reporteSdr/image.tsx).
    outputFileTracingIncludes: {
      "/api/cron/reporte-sdr": ["./lib/reporteSdr/fonts/**"],
      "/api/reporte-sdr": ["./lib/reporteSdr/fonts/**"],
      // Academias del Entrenamiento cliente (se leen con fs en lib/academiaSdr/server/source.ts).
      "/api/academia-sdr": ["./content/entrenamiento/**"],
      "/api/academia-sdr/html": ["./content/entrenamiento/**"],
      // Página del Onboarding SDR (se lee con fs en app/api/onboarding-sdr/html).
      "/api/onboarding-sdr/html": ["./content/onboarding-sdr/**"],
      // Guía del equipo de prospección (PDF que se abre desde el Centro).
      "/api/centro/guia": ["./content/centro/**"],
    },
  }
};

module.exports = nextConfig;
