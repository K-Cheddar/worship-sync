/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    fontSize: {
      xs: "clamp(0.6875rem, 0.625vw, 0.9375rem)",
      sm: "clamp(0.8125rem, 0.875vw, 1.0625rem)",
      base: "clamp(0.9375rem, 1.125vw, 1.25rem)",
      lg: "clamp(1.0625rem, 1.25vw, 1.375rem)",
      xl: "clamp(1.1875rem, 1.5625vw, 1.6875rem)",
      "2xl": "clamp(1.375rem, 1.875vw, 2.125rem)",
      "3xl": "clamp(1.5625rem, 2.1875vw, 2.8125rem)",
      "4xl": "clamp(1.875rem, 2.5vw, 3.125rem)",
      "5xl": "clamp(2.1875rem, 2.8125vw, 3.5625rem)",
      "6xl": "clamp(2.5rem, 3.125vw, 4rem)",
      "7xl": "clamp(2.8125rem, 3.75vw, 4.6875rem)",
      "8xl": "clamp(3.125rem, 4.5vw, 6.25rem)",
    },
    extend: {
      padding: {
        px: "1px",
        0: "0",
        0.5: "clamp(0.125rem,0.125vw,0.15625rem)",
        1: "clamp(0.1875rem,0.25vw,0.3125rem)",
        1.5: "clamp(0.25rem,0.375vw,0.46875rem)",
        2: "clamp(0.3125rem,0.5vw,0.625rem)",
        2.5: "clamp(0.375rem,0.625vw,0.78125rem)",
        3: "clamp(0.4375rem,0.75vw,0.9375rem)",
        3.5: "clamp(0.5rem,0.875vw,1.09375rem)",
        4: "clamp(0.625rem,1vw,1.25rem)",
        5: "clamp(0.75rem,1.25vw,1.5625rem)",
        6: "clamp(0.875rem,1.5vw,1.875rem)",
        7: "clamp(1rem,1.75vw,2.1875rem)",
        8: "clamp(1rem,2vw,2.5rem)",
        9: "clamp(1.125rem,2.25vw,2.8125rem)",
        10: "clamp(1.25rem,2.5vw,3.125rem)",
        11: "clamp(1.375rem,2.75vw,3.4375rem)",
        12: "clamp(1.5rem,3vw,3.75rem)",
        14: "clamp(1.75rem,3.5vw,4.375rem)",
        16: "clamp(2rem,4vw,5rem)",
        20: "clamp(2.5rem,5vw,6.25rem)",
        24: "clamp(3rem,6vw,7.5rem)",
        28: "clamp(3.5rem,7vw,8.75rem)",
        32: "clamp(4rem,8vw,10rem)",
        36: "clamp(4.5rem,9vw,11.25rem)",
        40: "clamp(5rem,10vw,12.5rem)",
        44: "clamp(5.5rem,11vw,13.75rem)",
        48: "clamp(6rem,12vw,15rem)",
        52: "clamp(6.5rem,13vw,16.25rem)",
        56: "clamp(7rem,14vw,17.5rem)",
        60: "clamp(7.5rem,15vw,18.75rem)",
        64: "clamp(8rem,16vw,20rem)",
        72: "clamp(9rem,18vw,22.5rem)",
        80: "clamp(10rem,20vw,25rem)",
        96: "clamp(12rem,24vw,30rem)",
      },
      margin: {
        px: "1px",
        0: "0",
        0.5: "clamp(0.125rem,0.125vw,0.15625rem)",
        1: "clamp(0.1875rem,0.25vw,0.3125rem)",
        1.5: "clamp(0.25rem,0.375vw,0.46875rem)",
        2: "clamp(0.3125rem,0.5vw,0.625rem)",
        2.5: "clamp(0.375rem,0.625vw,0.78125rem)",
        3: "clamp(0.4375rem,0.75vw,0.9375rem)",
        3.5: "clamp(0.5rem,0.875vw,1.09375rem)",
        4: "clamp(0.625rem,1vw,1.25rem)",
        5: "clamp(0.75rem,1.25vw,1.5625rem)",
        6: "clamp(0.875rem,1.5vw,1.875rem)",
        7: "clamp(1rem,1.75vw,2.1875rem)",
        8: "clamp(1rem,2vw,2.5rem)",
        9: "clamp(1.125rem,2.25vw,2.8125rem)",
        10: "clamp(1.25rem,2.5vw,3.125rem)",
        11: "clamp(1.375rem,2.75vw,3.4375rem)",
        12: "clamp(1.5rem,3vw,3.75rem)",
        14: "clamp(1.75rem,3.5vw,4.375rem)",
        16: "clamp(2rem,4vw,5rem)",
        20: "clamp(2.5rem,5vw,6.25rem)",
        24: "clamp(3rem,6vw,7.5rem)",
        28: "clamp(3.5rem,7vw,8.75rem)",
        32: "clamp(4rem,8vw,10rem)",
        36: "clamp(4.5rem,9vw,11.25rem)",
        40: "clamp(5rem,10vw,12.5rem)",
        44: "clamp(5.5rem,11vw,13.75rem)",
        48: "clamp(6rem,12vw,15rem)",
        52: "clamp(6.5rem,13vw,16.25rem)",
        56: "clamp(7rem,14vw,17.5rem)",
        60: "clamp(7.5rem,15vw,18.75rem)",
        64: "clamp(8rem,16vw,20rem)",
        72: "clamp(9rem,18vw,22.5rem)",
        80: "clamp(10rem,20vw,25rem)",
        96: "clamp(12rem,24vw,30rem)",
      },
      gap: {
        px: "1px",
        0: "0",
        0.5: "clamp(0.125rem,0.125vw,0.15625rem)",
        1: "clamp(0.1875rem,0.25vw,0.3125rem)",
        1.5: "clamp(0.25rem,0.375vw,0.46875rem)",
        2: "clamp(0.3125rem,0.5vw,0.625rem)",
        2.5: "clamp(0.375rem,0.625vw,0.78125rem)",
        3: "clamp(0.4375rem,0.75vw,0.9375rem)",
        3.5: "clamp(0.5rem,0.875vw,1.09375rem)",
        4: "clamp(0.625rem,1vw,1.25rem)",
        5: "clamp(0.75rem,1.25vw,1.5625rem)",
        6: "clamp(0.875rem,1.5vw,1.875rem)",
        7: "clamp(1rem,1.75vw,2.1875rem)",
        8: "clamp(1rem,2vw,2.5rem)",
        9: "clamp(1.125rem,2.25vw,2.8125rem)",
        10: "clamp(1.25rem,2.5vw,3.125rem)",
        11: "clamp(1.375rem,2.75vw,3.4375rem)",
        12: "clamp(1.5rem,3vw,3.75rem)",
        14: "clamp(1.75rem,3.5vw,4.375rem)",
        16: "clamp(2rem,4vw,5rem)",
        20: "clamp(2.5rem,5vw,6.25rem)",
        24: "clamp(3rem,6vw,7.5rem)",
        28: "clamp(3.5rem,7vw,8.75rem)",
        32: "clamp(4rem,8vw,10rem)",
        36: "clamp(4.5rem,9vw,11.25rem)",
        40: "clamp(5rem,10vw,12.5rem)",
        44: "clamp(5.5rem,11vw,13.75rem)",
        48: "clamp(6rem,12vw,15rem)",
        52: "clamp(6.5rem,13vw,16.25rem)",
        56: "clamp(7rem,14vw,17.5rem)",
        60: "clamp(7.5rem,15vw,18.75rem)",
        64: "clamp(8rem,16vw,20rem)",
        72: "clamp(9rem,18vw,22.5rem)",
        80: "clamp(10rem,20vw,25rem)",
        96: "clamp(12rem,24vw,30rem)",
      },
    },
  },
  plugins: [],
};
