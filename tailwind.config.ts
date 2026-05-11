import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        sidebar: "#26215C",
        canvas: "#F4F2FB",
        brand: {
          DEFAULT: "#3D2878",
          soft: "#7F77DD",
          tint: "#EEEDFE"
        },
        ink: {
          DEFAULT: "#1A1733",
          muted: "#6B6884",
          subtle: "#9794AC"
        },
        success: { bg: "#E1F5EE", fg: "#0F6E56" },
        warning: { bg: "#FAEEDA", fg: "#854F0B" },
        info:    { bg: "#E6F1FB", fg: "#185FA5" },
        danger:  { bg: "#FAECE7", fg: "#993C1D" }
      },
      borderRadius: {
        card: "12px"
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"]
      },
      boxShadow: {
        card: "0 1px 0 rgba(38,33,92,0.04)"
      }
    }
  },
  plugins: []
};

export default config;
