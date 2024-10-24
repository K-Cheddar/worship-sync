/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    fontSize: {
      'xs': 'clamp(0.55rem, 0.5vw, 0.75rem)',
      'sm': 'clamp(0.65rem, 0.7vw, 0.875rem)',
      'base': 'clamp(0.75rem, .9vw, 1rem)',
      'lg': 'clamp(0.85rem, 1vw, 1.125rem)',
      'xl': 'clamp(0.95rem, 1.25vw, 1.5rem)',
      '2xl': 'clamp(1.1rem, 1.5vw, 1.875rem)',
      '3xl': 'clamp(1.25rem, 1.75vw, 2.25rem)',
      '4xl': 'clamp(1.5rem, 2vw, 2.5rem)',
      '5xl': 'clamp(1.75rem, 2.25vw, 3rem)',
      '6xl': 'clamp(2rem, 2.5vw, 3.5rem)',
      '7xl': 'clamp(2.5rem, 3vw, 4.5rem)',
      '8xl': 'clamp(3rem, 4vw, 6rem)',
    },
    extend: {},
  },
  plugins: [],
}

