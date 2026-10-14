import type { Page } from '@playwright/test'

// Whether the browser has the WebAuthn calls a passkey sign-up needs. It depends on the platform as well as the
// engine: WebKit has them on macOS, and not on Linux, where CI runs it.
export const browserHasPasskeys = (page: Page) =>
  page.evaluate(() => {
    const attestation = window.AuthenticatorAttestationResponse?.prototype
    return (
      typeof window.PublicKeyCredential === 'function' &&
      typeof attestation?.getPublicKey === 'function' &&
      typeof attestation.getPublicKeyAlgorithm === 'function' &&
      typeof attestation.getAuthenticatorData === 'function'
    )
  })
