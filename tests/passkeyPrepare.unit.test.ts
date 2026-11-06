import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

// Every request to the worker goes through requestJson, so counting its calls counts the options fetched.
const requestJson = vi.hoisted(() => vi.fn<(path: string, init?: unknown) => Promise<unknown>>())
vi.mock('../src/sync/server', async (original) => ({
  ...(await original<typeof import('../src/sync/server')>()),
  requestJson
}))

// The sync client listens on window as it loads, and the ceremonies here never sync.
vi.mock('../src/sync/syncClient', () => ({ sync: vi.fn() }))

const { approveConnection, preparePasskey } = await import('../src/sync/passkeys')

const OPTIONS = { challenge: 'AAAA', rpId: 'localhost', userVerification: 'required', timeout: 60_000 }
const FOUR_MINUTES = 4 * 60_000

const optionsFetched = () => requestJson.mock.calls.filter(([path]) => path === '/auth/connect/options').length

describe('preparePasskey', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('window', globalThis)
    // The user cancels the passkey sheet.
    vi.stubGlobal('navigator', {
      credentials: { get: () => Promise.reject(new DOMException('cancelled', 'NotAllowedError')) }
    })
    requestJson.mockReset()
    requestJson.mockResolvedValue(OPTIONS)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('keeps the options fresh until the page goes', async () => {
    const page = new AbortController()
    preparePasskey('connect', page.signal)
    await vi.advanceTimersByTimeAsync(FOUR_MINUTES)
    expect(optionsFetched()).toBe(2)

    page.abort()
    await vi.advanceTimersByTimeAsync(5 * FOUR_MINUTES)
    expect(optionsFetched()).toBe(2)
  })

  it('prepares new options after a cancelled sheet, and stops them when the page goes', async () => {
    const page = new AbortController()
    preparePasskey('connect', page.signal)
    await expect(approveConnection('request')).rejects.toThrow('cancelled')
    // The tap used the prepared options, and the ceremony prepared new ones for the next tap.
    expect(optionsFetched()).toBe(2)
    await vi.advanceTimersByTimeAsync(FOUR_MINUTES)
    expect(optionsFetched()).toBe(3)

    page.abort()
    await vi.advanceTimersByTimeAsync(5 * FOUR_MINUTES)
    expect(optionsFetched()).toBe(3)
  })

  it('prepares nothing after a tap once the page has gone', async () => {
    const page = new AbortController()
    preparePasskey('connect', page.signal)
    page.abort()
    await expect(approveConnection('request')).rejects.toThrow('cancelled')
    await vi.advanceTimersByTimeAsync(5 * FOUR_MINUTES)
    // The prepared options went with the page, so the tap fetched its own, and nothing after it.
    expect(optionsFetched()).toBe(2)
  })
})
