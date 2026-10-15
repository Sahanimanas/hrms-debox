/** @type {import('tailwindcss').Config} */
// Design tokens follow the "Xeno HR — Modern UI Redesign" Figma file.
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Public Sans"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', '"Public Sans"', 'sans-serif'],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",

        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },

        // Figma tokens
        canvas: '#f6f7fb',
        surface: '#ffffff',
        subtle: '#eef1f6',
        ink: { DEFAULT: '#101828', secondary: '#475467', muted: '#94a0b4' },
        line: { DEFAULT: '#e3e7ef', strong: '#cbd2de' },
        navy: { DEFAULT: '#0b1220', hover: '#121b2e', border: '#1c2740', text: '#94a0b4' },
        brand: { DEFAULT: '#facc15', hover: '#eab308', subtle: '#fefbe8', text: '#a16207', on: '#0b1220' },
        success: { solid: '#12b76a', fg: '#027a48', bg: '#ecfdf3' },
        warning: { solid: '#f79009', fg: '#b54708', bg: '#fffaeb' },
        danger: { solid: '#f04438', fg: '#b42318', bg: '#fef3f2' },
        info: { solid: '#2e90fa', fg: '#175cd3', bg: '#eff8ff' },
        violet: { fg: '#5925dc', bg: '#f4f3ff' },
        teal: { solid: '#15b79e', fg: '#107569', bg: '#f0fdf9' },
      },
      borderRadius: {
        sm: '6px',
        md: '10px',
        lg: '14px',
        hero: '20px',
      },
      boxShadow: {
        xs: '0 1px 2px 0 rgba(15, 23, 41, 0.05)',
        sm: '0 1px 3px 0 rgba(15, 23, 41, 0.08), 0 1px 2px 0 rgba(15, 23, 41, 0.04)',
      },
    },
  },
  plugins: [],
}
