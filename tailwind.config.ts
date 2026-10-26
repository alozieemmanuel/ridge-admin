import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Colors come from CSS variables (see globals.css) so the same class
      // names work in dark, light and system themes.
      colors: {
        pagebg: "rgb(var(--c-pagebg) / <alpha-value>)",
        cardbg: "rgb(var(--c-cardbg) / <alpha-value>)",
        inputbg: "rgb(var(--c-inputbg) / <alpha-value>)",
        tint: "rgb(var(--c-tint) / <alpha-value>)",
        fg: "rgb(var(--c-fg) / <alpha-value>)",
        muted: "rgb(var(--c-muted) / <alpha-value>)",
        border: "rgb(var(--c-border) / <alpha-value>)",
        gold: "rgb(var(--c-gold) / <alpha-value>)",
        golddark: "rgb(var(--c-golddark) / <alpha-value>)",
        goldlight: "rgb(var(--c-goldlight) / <alpha-value>)",
      },
      // Inter everywhere. "serif" is kept as a name because the headings use font-serif; it now maps to Inter too.
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "system-ui", "-apple-system", "Segoe UI", "Arial", "sans-serif"],
        serif: ["var(--font-inter)", "Inter", "system-ui", "-apple-system", "Segoe UI", "Arial", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
