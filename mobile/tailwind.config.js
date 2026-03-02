/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      fontFamily: {
        'outfit': ['Outfit'],
        'jakarta': ['PlusJakartaSans'],
        'satoshi': ['Satoshi-Black'],
      },
      colors: {
        background: '#111111',
      },
    },
  },
  plugins: [],
};
