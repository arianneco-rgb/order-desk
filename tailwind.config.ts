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
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};

export default config;
