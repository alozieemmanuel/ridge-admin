import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        pagebg: "#0A0806",
        cardbg: "#15110B",
        fg: "#F5EFE0",
        muted: "#A89977",
        border: "rgba(201, 151, 46, 0.22)",
        gold: "#C9972E",
        golddark: "#9C7220",
        goldlight: "#F1C866",
      },
      fontFamily: {
        serif: ["Georgia", "Times New Roman", "serif"],
      },
    },
  },
  plugins: [],
};

export default config;
