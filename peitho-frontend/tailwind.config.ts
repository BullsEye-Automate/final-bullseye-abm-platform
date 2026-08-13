import type { Config } from "tailwindcss";

// Mismos colores de marca que bullseye-abm-platform (ver CLAUDE.md raíz, sección Branding).
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        sidebar: "#251762",
        accent: "#62E0D8",
      },
      fontFamily: {
        sans: ["Outfit", "ui-sans-serif", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
