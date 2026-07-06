/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{html,ts,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        "secondary-container": "#454a4f",
        "surface": "#111317",
        "inverse-surface": "#e2e2e8",
        "on-surface": "#e2e2e8",
        "inverse-primary": "#5c5f60",
        "on-tertiary-fixed": "#221b00",
        "on-error-container": "#ffdad6",
        "on-primary-container": "#626566",
        "secondary-fixed-dim": "#c3c7cd",
        "on-error": "#690005",
        "surface-container-high": "#282a2e",
        "on-secondary-fixed": "#171c20",
        "secondary": "#c3c7cd",
        "on-tertiary-fixed-variant": "#554600",
        "secondary-fixed": "#dfe3e9",
        "on-tertiary-container": "#776300",
        "tertiary-fixed-dim": "#e9c400",
        "error": "#ffb4ab",
        "surface-bright": "#37393e",
        "on-primary-fixed-variant": "#454748",
        "on-tertiary": "#3b2f00",
        "on-background": "#e2e2e8",
        "primary-fixed-dim": "#c5c7c8",
        "tertiary": "#ffffff",
        "on-surface-variant": "#c4c7c8",
        "inverse-on-surface": "#2f3035",
        "background": "#111317",
        "surface-container-lowest": "#0c0e12",
        "error-container": "#93000a",
        "on-primary-fixed": "#191c1d",
        "tertiary-fixed": "#ffe171",
        "on-secondary-fixed-variant": "#43474c",
        "on-secondary-container": "#b4b9bf",
        "on-secondary": "#2c3136",
        "surface-container": "#1e2024",
        "tertiary-container": "#ffe171",
        "surface-tint": "#c5c7c8",
        "surface-dim": "#111317",
        "outline": "#8e9193",
        "primary-container": "#e1e3e4",
        "primary-fixed": "#e1e3e4",
        "surface-container-low": "#1a1c20",
        "surface-variant": "#333539",
        "outline-variant": "#444749",
        "primary": "#ffffff",
        "on-primary": "#2e3132",
        "surface-container-highest": "#333539"
      },
      borderRadius: {
        "DEFAULT": "0.25rem",
        "lg": "0.5rem",
        "xl": "0.75rem",
        "full": "9999px"
      },
      spacing: {
        "sm": "8px",
        "xl": "40px",
        "md": "16px",
        "base": "4px",
        "lg": "24px",
        "container-max": "1200px",
        "xs": "4px",
        "gutter": "24px"
      },
      fontFamily: {
        "display-lg": ["Libre Caslon Text", "serif"],
        "body-reading": ["Libre Caslon Text", "serif"],
        "label-caps": ["Geist", "sans-serif"],
        "display-lg-mobile": ["Libre Caslon Text", "serif"],
        "body-main": ["Geist", "sans-serif"],
        "code": ["JetBrains Mono", "monospace"],
        "headline-md": ["Geist", "sans-serif"]
      },
      fontSize: {
        "display-lg": ["48px", { lineHeight: "1.1", letterSpacing: "-0.02em", fontWeight: "400" }],
        "body-reading": ["18px", { lineHeight: "1.7", fontWeight: "400" }],
        "label-caps": ["12px", { lineHeight: "1", letterSpacing: "0.05em", fontWeight: "600" }],
        "display-lg-mobile": ["32px", { lineHeight: "1.2", fontWeight: "400" }],
        "body-main": ["16px", { lineHeight: "1.6", fontWeight: "400" }],
        "code": ["14px", { lineHeight: "1.5", fontWeight: "400" }],
        "headline-md": ["24px", { lineHeight: "1.4", letterSpacing: "-0.01em", fontWeight: "500" }]
      }
    }
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/container-queries')
  ],
}
