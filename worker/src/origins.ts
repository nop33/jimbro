// The app's origins. CORS answers them, and the passkey routes take the RP ID from them.
const ALLOWED_ORIGINS = new Set(['https://jimbro.nop33.com', 'http://localhost:5173'])

export interface OriginEnv {
  // One more origin to allow in a local run, such as a dev server on another port.
  DEV_ORIGIN?: string
}

export const isAllowedOrigin = (origin: string | null, env: OriginEnv): origin is string =>
  origin !== null && (ALLOWED_ORIGINS.has(origin) || origin === env.DEV_ORIGIN)
