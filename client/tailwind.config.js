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
    extend: {
      padding: {
        px: '1px',
        0: '0',
        0.5: 'clamp(0.0625rem,0.125vw,0.125rem)',
        1: 'clamp(0.125rem,0.25vw,0.25rem)',
        1.5: 'clamp(0.1875rem,0.375vw,0.375rem)',
        2: 'clamp(0.25rem,0.5vw,0.5rem)',
        2.5: 'clamp(0.3125rem,0.625vw,0.625rem)',
        3: 'clamp(0.375rem,0.75vw,0.75rem)',
        3.5: 'clamp(0.4375rem,0.875vw,0.875rem)',
        4: 'clamp(0.5rem,1vw,1rem)',
        5: 'clamp(0.625rem,1.25vw,1.25rem)',
        6: 'clamp(0.75rem,1.5vw,1.5rem)',
        7: 'clamp(0.875rem,1.75vw,1.75rem)',
        8: 'clamp(1rem,2vw,2rem)',
        9: 'clamp(1.125rem,2.25vw,2.25rem)',
        10: 'clamp(1.25rem,2.5vw,2.5rem)',
        11: 'clamp(1.375rem,2.75vw,2.75rem)',
        12: 'clamp(1.5rem,3vw,3rem)',
        14: 'clamp(1.75rem,3.5vw,3.5rem)',
        16: 'clamp(2rem,4vw,4rem)',
        20: 'clamp(2.5rem,5vw,5rem)',
        24: 'clamp(3rem,6vw,6rem)',
        28: 'clamp(3.5rem,7vw,7rem)',
        32: 'clamp(4rem,8vw,8rem)',
        36: 'clamp(4.5rem,9vw,9rem)',
        40: 'clamp(5rem,10vw,10rem)',
        44: 'clamp(5.5rem,11vw,11rem)',
        48: 'clamp(6rem,12vw,12rem)',
        52: 'clamp(6.5rem,13vw,13rem)',
        56: 'clamp(7rem,14vw,14rem)',
        60: 'clamp(7.5rem,15vw,15rem)',
        64: 'clamp(8rem,16vw,16rem)',
        72: 'clamp(9rem,18vw,18rem)',
        80: 'clamp(10rem,20vw,20rem)',
        96: 'clamp(12rem,24vw,24rem)',
      },
      margin: {
        px: '1px',
        0: '0',
        0.5: 'clamp(0.0625rem,0.125vw,0.125rem)',
        1: 'clamp(0.125rem,0.25vw,0.25rem)',
        1.5: 'clamp(0.1875rem,0.375vw,0.375rem)',
        2: 'clamp(0.25rem,0.5vw,0.5rem)',
        2.5: 'clamp(0.3125rem,0.625vw,0.625rem)',
        3: 'clamp(0.375rem,0.75vw,0.75rem)',
        3.5: 'clamp(0.4375rem,0.875vw,0.875rem)',
        4: 'clamp(0.5rem,1vw,1rem)',
        5: 'clamp(0.625rem,1.25vw,1.25rem)',
        6: 'clamp(0.75rem,1.5vw,1.5rem)',
        7: 'clamp(0.875rem,1.75vw,1.75rem)',
        8: 'clamp(1rem,2vw,2rem)',
        9: 'clamp(1.125rem,2.25vw,2.25rem)',
        10: 'clamp(1.25rem,2.5vw,2.5rem)',
        11: 'clamp(1.375rem,2.75vw,2.75rem)',
        12: 'clamp(1.5rem,3vw,3rem)',
        14: 'clamp(1.75rem,3.5vw,3.5rem)',
        16: 'clamp(2rem,4vw,4rem)',
        20: 'clamp(2.5rem,5vw,5rem)',
        24: 'clamp(3rem,6vw,6rem)',
        28: 'clamp(3.5rem,7vw,7rem)',
        32: 'clamp(4rem,8vw,8rem)',
        36: 'clamp(4.5rem,9vw,9rem)',
        40: 'clamp(5rem,10vw,10rem)',
        44: 'clamp(5.5rem,11vw,11rem)',
        48: 'clamp(6rem,12vw,12rem)',
        52: 'clamp(6.5rem,13vw,13rem)',
        56: 'clamp(7rem,14vw,14rem)',
        60: 'clamp(7.5rem,15vw,15rem)',
        64: 'clamp(8rem,16vw,16rem)',
        72: 'clamp(9rem,18vw,18rem)',
        80: 'clamp(10rem,20vw,20rem)',
        96: 'clamp(12rem,24vw,24rem)',
      },
      gap: {
        px: '1px',
        0: '0',
        0.5: 'clamp(0.0625rem,0.125vw,0.125rem)',
        1: 'clamp(0.125rem,0.25vw,0.25rem)',
        1.5: 'clamp(0.1875rem,0.375vw,0.375rem)',
        2: 'clamp(0.25rem,0.5vw,0.5rem)',
        2.5: 'clamp(0.3125rem,0.625vw,0.625rem)',
        3: 'clamp(0.375rem,0.75vw,0.75rem)',
        3.5: 'clamp(0.4375rem,0.875vw,0.875rem)',
        4: 'clamp(0.5rem,1vw,1rem)',
        5: 'clamp(0.625rem,1.25vw,1.25rem)',
        6: 'clamp(0.75rem,1.5vw,1.5rem)',
        7: 'clamp(0.875rem,1.75vw,1.75rem)',
        8: 'clamp(1rem,2vw,2rem)',
        9: 'clamp(1.125rem,2.25vw,2.25rem)',
        10: 'clamp(1.25rem,2.5vw,2.5rem)',
        11: 'clamp(1.375rem,2.75vw,2.75rem)',
        12: 'clamp(1.5rem,3vw,3rem)',
        14: 'clamp(1.75rem,3.5vw,3.5rem)',
        16: 'clamp(2rem,4vw,4rem)',
        20: 'clamp(2.5rem,5vw,5rem)',
        24: 'clamp(3rem,6vw,6rem)',
        28: 'clamp(3.5rem,7vw,7rem)',
        32: 'clamp(4rem,8vw,8rem)',
        36: 'clamp(4.5rem,9vw,9rem)',
        40: 'clamp(5rem,10vw,10rem)',
        44: 'clamp(5.5rem,11vw,11rem)',
        48: 'clamp(6rem,12vw,12rem)',
        52: 'clamp(6.5rem,13vw,13rem)',
        56: 'clamp(7rem,14vw,14rem)',
        60: 'clamp(7.5rem,15vw,15rem)',
        64: 'clamp(8rem,16vw,16rem)',
        72: 'clamp(9rem,18vw,18rem)',
        80: 'clamp(10rem,20vw,20rem)',
        96: 'clamp(12rem,24vw,24rem)',
      }
    },
  },
  plugins: [],
}
