import { sha256 } from './webauthn'

export interface AuthEnv {
  AUTH_TOKENS: string // JSON { "token": "userId", ...}
  jimbro: D1Database
}

const timingSafeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false
  const encoder = new TextEncoder()
  const bufferA = encoder.encode(a)
  const bufferB = encoder.encode(b)
  return crypto.subtle.timingSafeEqual(bufferA, bufferB)
}

export const bearerToken = (authHeader: string | null): string | null => {
  if (!authHeader) return null
  const token = authHeader.replace('Bearer ', '')
  if (!token || token === authHeader) return null
  return token
}

// D1 keeps only this hash of a token a passkey handed out.
export const hashToken = async (token: string) =>
  [...(await sha256(new TextEncoder().encode(token)))].map((byte) => byte.toString(16).padStart(2, '0')).join('')

// The user a bearer token belongs to: a token from AUTH_TOKENS (tests, MCP, local runs), or one a passkey sign-up or
// sign-in stored in D1.
export const resolveUserId = async (authHeader: string | null, env: AuthEnv): Promise<string | null> => {
  const token = bearerToken(authHeader)
  if (!token) return null

  const tokenMap: Record<string, string> = JSON.parse(env.AUTH_TOKENS)

  for (const [secret, userId] of Object.entries(tokenMap)) {
    if (timingSafeEqual(token, secret)) return userId
  }

  const row = await env.jimbro
    .prepare('SELECT user_id FROM auth_tokens WHERE token_hash = ?1')
    .bind(await hashToken(token))
    .first<{ user_id: string }>()
  return row?.user_id ?? null
}
