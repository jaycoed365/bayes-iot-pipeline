/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#0a0a0f",
          900: "#11121a",
          800: "#1a1c26",
          700: "#262934",
          600: "#3a3e4d",
        },
        accent: {
          temp:     "#f97316",  // orange
          humidity: "#3b82f6",  // blue
          pressure: "#a855f7",  // purple
          voc:      "#10b981",  // green
        },
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
