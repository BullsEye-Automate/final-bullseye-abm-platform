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
    },
  }
};

module.exports = nextConfig;
