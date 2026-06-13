/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#ffffff",
          dark: "#0d1b2a",
        },
        paper: {
          DEFAULT: "#f8fafc",
          dark: "#152238",
        },
        accent: {
          DEFAULT: "#6366f1",
          hover: "#4f46e5",
        },
        // Custom dark palette — deep navy instead of system gray
        dk: {
          bg: "#0d1b2a",
          card: "#152238",
          border: "#1e3348",
          hover: "#243b53",
        },
      },
      fontFamily: {
        sans: ['"Noto Sans SC"', '"PingFang SC"', '"Microsoft YaHei"', "sans-serif"],
        serif: ['"Noto Serif SC"', '"Source Han Serif SC"', "serif"],
      },
      maxWidth: {
        reader: "800px",
      },
    },
  },
  plugins: [],
};
