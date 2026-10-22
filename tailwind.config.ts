import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Ritual Matcha forest-green brand palette
        forest: {
          50: "#f2f7f4",
          100: "#dfece4",
          200: "#c1d9cb",
          300: "#97beaa",
          400: "#6a9e84",
          500: "#4a8267",
          600: "#376851",
          700: "#2c5443",
          800: "#254437",
          900: "#1f382e",
          950: "#101f19",
        },
        cream: "#faf7f0",
        matcha: "#7fa87a",

        // Semantic status pairs, lifted from the Ritual Order Board so a
        // warning means the same colour on the board and in here. Each
        // has a `bg` tuned to sit on the sage ground without glaring.
        ok: { DEFAULT: "#3f7a5f", bg: "#e3efe8" },
        warn: { DEFAULT: "#96690f", bg: "#f6eed9" },
        crit: { DEFAULT: "#9d3a2a", bg: "#f8e5e0" },
        rush: { DEFAULT: "#b02a1c", ink: "#ffffff" },
        mute: { DEFAULT: "#5f6f66", bg: "#e8ede7" },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        display: ["var(--font-display)", "Georgia", "ui-serif", "serif"],
        mono: ["var(--font-mono)", "ui-monospace", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
