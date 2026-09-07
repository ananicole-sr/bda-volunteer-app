/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        bamxOrange: '#e88e29',
        bamxRed: '#d03030',
        bamxGreen: '#218750',
        bamxGray: '#666665',
      },
    },
  },
  plugins: [],
};