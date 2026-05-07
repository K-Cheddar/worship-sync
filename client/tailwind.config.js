/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      screens: {
        coarse: { raw: "(pointer: coarse)" },
      },
    },
  },
  plugins: [],
};
