/// <reference types="vite/client" />

declare const __APP_VERSION__: string

interface ImportMetaEnv {
  readonly VITE_SENTRY_DSN: string
  readonly MODE: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Vite's built-in `*.css` module type has no exports (side-effect-only
// import); `?inline` returns the compiled CSS as a string instead of
// auto-injecting a <style>/<link> tag, used to inject Tailwind output into a
// content-script shadow root (see src/content/content.tsx).
declare module '*.css?inline' {
  const css: string
  export default css
}
