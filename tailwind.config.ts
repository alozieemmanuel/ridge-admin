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
        fg: "rgb(var(--c-fg) / <alpha-value>)",
        muted: "rgb(var(--c-muted) / <alpha-value>)",
        border: "rgb(var(--c-border) / <alpha-value>)",
        gold: "rgb(var(--c-gold) / <alpha-value>)",
        golddark: "rgb(var(--c-golddark) / <alpha-value>)",
        goldlight: "rgb(var(--c-goldlight) / <alpha-value>)",
      },
      fontFamily: {
        serif: ["Georgia", "Times New Roman", "serif"],
      },
    },
  },
  plugins: [],
};

export default config;
