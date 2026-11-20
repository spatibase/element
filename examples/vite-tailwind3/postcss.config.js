// A Tailwind v3 host: every CSS file, including Element's, goes through this PostCSS pipeline.
// Tailwind v3 fails on `@layer` without a matching `@tailwind` directive, so this build only passes
// while the published stylesheets are plain CSS.
export default { plugins: { tailwindcss: {}, autoprefixer: {} } }
