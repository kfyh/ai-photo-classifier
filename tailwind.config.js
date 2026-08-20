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
          accent: '#38bdf8',    // Bluish AI accent
          pick: '#16a34a',      // Bright Green pick flag
          reject: '#dc2626',    // Bright Red reject X
          star: '#f59e0b',      // Yellowish stars
          selection: '#f59e0b', // Yellowish user selection
        },
        accessible: {
          pick: {
            DEFAULT: '#16a34a',
            dark: '#15803d',
            light: '#4ade80',
            fg: '#f0fdf4',
            ghost: 'rgba(74, 222, 128, 0.35)',
          },
          reject: {
            DEFAULT: '#dc2626',
            dark: '#b91c1c',
            light: '#f87171',
            fg: '#fef2f2',
            ghost: 'rgba(248, 113, 113, 0.35)',
          },
          ai: {
            DEFAULT: '#38bdf8',
            dark: '#0284c7',
            light: '#7dd3fc',
            bg: '#0c2340',
          },
          selection: {
            DEFAULT: '#fbbf24',
            border: '#f59e0b',
          }
        }
      },
    },
  },
  plugins: [],
};
