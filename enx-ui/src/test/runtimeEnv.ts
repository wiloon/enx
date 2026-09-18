import { RUNTIME_ENV_GLOBAL, type RuntimeEnv } from '@/lib/runtimeEnv'

// Test-side stand-in for the <script> the root layout injects.
export function setRuntimeEnv(values: Partial<RuntimeEnv>): void {
  ;(window as unknown as Record<string, RuntimeEnv>)[RUNTIME_ENV_GLOBAL] = {
    ENX_EXTENSION_ID: '',
    ENX_EXTENSION_WEB_STORE_URL: '',
    ...values,
  }
}
