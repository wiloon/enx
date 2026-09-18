import { RUNTIME_ENV_GLOBAL, serverRuntimeEnv } from '@/lib/runtimeEnv'

// Server component: runs per request, so the values are the container's, not
// the build's. Escaping `<` stops a value containing "</script>" from closing
// the tag early.
export default function RuntimeEnvScript() {
  const json = JSON.stringify(serverRuntimeEnv()).replace(/</g, '\\u003c')
  return (
    <script
      id="enx-runtime-env"
      dangerouslySetInnerHTML={{
        __html: `window.${RUNTIME_ENV_GLOBAL}=${json}`,
      }}
    />
  )
}
