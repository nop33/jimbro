// The parts of WebAuthn the worker checks, on WebCrypto alone. Registrations use attestation 'none' and the browser's
// getPublicKey(), so no CBOR parser is needed: the worker reads the public key as SPKI, and only the fixed-layout
// prefix of the authenticator data.

export const ES256 = -7
export const RS256 = -257
export const ALGORITHMS = [ES256, RS256] as const

const FLAG_USER_PRESENT = 0x01
const FLAG_USER_VERIFIED = 0x04
const FLAG_ATTESTED_CREDENTIAL = 0x40

export const toBase64Url = (bytes: Uint8Array) => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export const fromBase64Url = (text: string): Uint8Array<ArrayBuffer> | null => {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null
  const binary = atob(
    text
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(text.length / 4) * 4, '=')
  )
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export const randomBase64Url = (length: number) => toBase64Url(crypto.getRandomValues(new Uint8Array(length)))

export const sha256 = async (data: ArrayBuffer | ArrayBufferView) =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', data))

const sameBytes = (left: Uint8Array, right: Uint8Array) =>
  left.length === right.length && left.every((byte, index) => byte === right[index])

export interface ClientData {
  type: string
  challenge: string
  origin: string
}

// The browser's clientDataJSON, or null when it is not one.
export const readClientData = (bytes: Uint8Array): ClientData | null => {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (!parsed || typeof parsed !== 'object') return null
    const { type, challenge, origin } = parsed as Record<string, unknown>
    if (typeof type !== 'string' || typeof challenge !== 'string' || typeof origin !== 'string') return null
    return { type, challenge, origin }
  } catch {
    return null
  }
}

export interface AuthenticatorData {
  rpIdHash: Uint8Array
  userPresent: boolean
  userVerified: boolean
  signCount: number
  // Only in a registration's authenticator data.
  credentialId?: Uint8Array
}

// The fixed-layout start of the authenticator data: rpIdHash (32 bytes), flags (1), signCount (4), then, when the
// attested credential flag is set, the AAGUID (16), the credential ID length (2) and the credential ID.
export const readAuthenticatorData = (bytes: Uint8Array<ArrayBuffer>): AuthenticatorData | null => {
  if (bytes.length < 37) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const flags = bytes[32]
  const data: AuthenticatorData = {
    rpIdHash: bytes.slice(0, 32),
    userPresent: (flags & FLAG_USER_PRESENT) !== 0,
    userVerified: (flags & FLAG_USER_VERIFIED) !== 0,
    signCount: view.getUint32(33)
  }
  if ((flags & FLAG_ATTESTED_CREDENTIAL) === 0) return data
  if (bytes.length < 55) return null
  const idLength = view.getUint16(53)
  if (bytes.length < 55 + idLength) return null
  return { ...data, credentialId: bytes.slice(55, 55 + idLength) }
}

export type AuthenticatorCheck =
  | 'invalid_authenticator_data'
  | 'wrong_rp'
  | 'user_not_present'
  | 'user_not_verified'
  | 'credential_mismatch'

// Checks the authenticator data against the RP ID, and that the user was present and verified. A registration also
// names the credential it made, which must be the one the browser reported.
export const checkAuthenticatorData = async (
  bytes: Uint8Array<ArrayBuffer>,
  rpId: string,
  credentialId?: Uint8Array
): Promise<{ ok: true; data: AuthenticatorData } | { ok: false; error: AuthenticatorCheck }> => {
  const data = readAuthenticatorData(bytes)
  if (!data) return { ok: false, error: 'invalid_authenticator_data' }
  if (!sameBytes(data.rpIdHash, await sha256(new TextEncoder().encode(rpId)))) return { ok: false, error: 'wrong_rp' }
  if (!data.userPresent) return { ok: false, error: 'user_not_present' }
  if (!data.userVerified) return { ok: false, error: 'user_not_verified' }
  if (credentialId && !(data.credentialId && sameBytes(data.credentialId, credentialId))) {
    return { ok: false, error: 'credential_mismatch' }
  }
  return { ok: true, data }
}

// Imports a public key the browser reported as SPKI, or resolves to null when it is not a key of that algorithm.
export const importPublicKey = async (spki: Uint8Array<ArrayBuffer>, alg: number): Promise<CryptoKey | null> => {
  const algorithm =
    alg === ES256
      ? { name: 'ECDSA', namedCurve: 'P-256' }
      : alg === RS256
        ? { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }
        : null
  if (!algorithm) return null
  try {
    return await crypto.subtle.importKey('spki', spki, algorithm, false, ['verify'])
  } catch {
    return null
  }
}

// One DER INTEGER of an ECDSA signature as 32 bytes, big-endian.
const readInteger = (der: Uint8Array, offset: number): { value: Uint8Array; next: number } | null => {
  if (der[offset] !== 0x02) return null
  const length = der[offset + 1]
  const start = offset + 2
  if (length === undefined || length === 0 || length > 33 || start + length > der.length) return null
  let value = der.slice(start, start + length)
  while (value.length > 32 && value[0] === 0) value = value.slice(1)
  if (value.length > 32) return null
  const padded = new Uint8Array(32)
  padded.set(value, 32 - value.length)
  return { value: padded, next: start + length }
}

// Authenticators sign ES256 as DER, SEQUENCE { INTEGER r, INTEGER s }, and WebCrypto verifies r || s.
export const derToRaw = (der: Uint8Array): Uint8Array<ArrayBuffer> | null => {
  if (der[0] !== 0x30 || der[1] !== der.length - 2) return null
  const r = readInteger(der, 2)
  if (!r) return null
  const s = readInteger(der, r.next)
  if (!s || s.next !== der.length) return null
  const raw = new Uint8Array(64)
  raw.set(r.value, 0)
  raw.set(s.value, 32)
  return raw
}

// Verifies an assertion: the signature over authenticatorData || SHA-256(clientDataJSON).
export const verifyAssertion = async (
  key: CryptoKey,
  alg: number,
  signature: Uint8Array<ArrayBuffer>,
  authenticatorData: Uint8Array<ArrayBuffer>,
  clientDataJSON: Uint8Array<ArrayBuffer>
) => {
  const clientDataHash = await sha256(clientDataJSON)
  const signed = new Uint8Array(authenticatorData.length + clientDataHash.length)
  signed.set(authenticatorData, 0)
  signed.set(clientDataHash, authenticatorData.length)
  if (alg === ES256) {
    const raw = derToRaw(signature)
    if (!raw) return false
    return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, raw, signed)
  }
  if (alg === RS256) return crypto.subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, key, signature, signed)
  return false
}
