export interface AuthEnv {
  AUTH_TOKENS: string // JSON { "token": "userId", ...}
}

const timingSafeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false
  const encoder = new TextEncoder()
  const bufferA = encoder.encode(a)
  const bufferB = encoder.encode(b)
  return crypto.subtle.timingSafeEqual(bufferA, bufferB)
}

export const resolveUserId = (authHeader: string | null, env: AuthEnv): string | null => {
  if (!authHeader) return null

  const token = authHeader.replace('Bearer ', '')
  if (!token || token === authHeader) return null

  const tokenMap: Record<string, string> = JSON.parse(env.AUTH_TOKENS)

  for (const [secret, userId] of Object.entries(tokenMap)) {
    if (timingSafeEqual(token, secret)) return userId
  }

  return null
}
