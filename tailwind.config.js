/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        dark: {
          bg: '#121316',
          panel: '#1a1c23',
          border: '#2a2d3a',
          hover: '#262933',
          accent: '#8b5cf6', // Deep purple accent
          pick: '#22c55e',   // Green pick flag
          reject: '#ef4444', // Red reject X
          star: '#f59e0b',   // Gold stars
        }
      }
    },
  },
  plugins: [],
};
