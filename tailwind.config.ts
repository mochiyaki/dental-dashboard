import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./dental-dashboard.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        shell: "rgb(var(--shell) / <alpha-value>)",
        panel: "rgb(var(--panel) / <alpha-value>)",
        panel2: "rgb(var(--panel2) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        ink: "rgb(var(--ink) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        cyanx: "rgb(var(--cyanx) / <alpha-value>)",
        mintx: "rgb(var(--mintx) / <alpha-value>)",
        amberx: "rgb(var(--amberx) / <alpha-value>)",
        rosex: "rgb(var(--rosex) / <alpha-value>)"
      }
    }
  },
  plugins: []
} satisfies Config;
