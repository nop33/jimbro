import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { screenWakeLock } from '../src/features/screenWakeLock'

class FakeSentinel {
  released = false
  release = vi.fn(async () => {
    this.released = true
  })
}

const visibility = { state: 'visible' as DocumentVisibilityState }
const page = new EventTarget()
const locks: FakeSentinel[] = []
const request = vi.fn(async () => {
  if (visibility.state !== 'visible') throw new DOMException('The document is hidden', 'NotAllowedError')
  const lock = new FakeSentinel()
  locks.push(lock)
  return lock
})

const show = async (state: DocumentVisibilityState) => {
  visibility.state = state
  for (const lock of locks) if (state === 'hidden') lock.released = true
  page.dispatchEvent(new Event('visibilitychange'))
  await vi.waitFor(() => undefined)
}

const held = () => locks.filter((lock) => !lock.released).length

describe('screenWakeLock', () => {
  beforeEach(() => {
    visibility.state = 'visible'
    locks.length = 0
    request.mockClear()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.stubGlobal('navigator', { wakeLock: { request } })
    vi.stubGlobal('document', {
      get visibilityState() {
        return visibility.state
      },
      addEventListener: page.addEventListener.bind(page)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('takes the lock again each time the page comes back into view', async () => {
    const mounted = new AbortController()
    screenWakeLock(mounted.signal)(true)
    await vi.waitFor(() => expect(held()).toBe(1))

    await show('hidden')
    expect(held()).toBe(0)
    await show('visible')
    await vi.waitFor(() => expect(held()).toBe(1))
    mounted.abort()
  })

  it('takes the lock once the page shows when it mounted out of view', async () => {
    visibility.state = 'hidden'
    const mounted = new AbortController()
    screenWakeLock(mounted.signal)(true)
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(0))

    await show('visible')
    await vi.waitFor(() => expect(held()).toBe(1))
    mounted.abort()
  })

  it('takes the lock when the page shows again after the browser refused it', async () => {
    request.mockRejectedValueOnce(new DOMException('Battery saver', 'NotAllowedError'))
    const mounted = new AbortController()
    screenWakeLock(mounted.signal)(true)
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    expect(held()).toBe(0)

    await show('hidden')
    await show('visible')
    await vi.waitFor(() => expect(held()).toBe(1))
    mounted.abort()
  })

  it('asks for no second lock while it holds one', async () => {
    const mounted = new AbortController()
    screenWakeLock(mounted.signal)(true)
    await vi.waitFor(() => expect(held()).toBe(1))

    page.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => undefined)
    expect(request).toHaveBeenCalledTimes(1)
    mounted.abort()
  })

  it('takes no lock until it is wanted, and lets it go once it is not', async () => {
    const mounted = new AbortController()
    const keepAwake = screenWakeLock(mounted.signal)
    await show('hidden')
    await show('visible')
    expect(request).toHaveBeenCalledTimes(0)

    keepAwake(true)
    await vi.waitFor(() => expect(held()).toBe(1))
    keepAwake(false)
    expect(held()).toBe(0)
    await show('hidden')
    await show('visible')
    expect(request).toHaveBeenCalledTimes(1)
    mounted.abort()
  })

  it('lets the lock go when the page goes', async () => {
    const mounted = new AbortController()
    screenWakeLock(mounted.signal)(true)
    await vi.waitFor(() => expect(held()).toBe(1))

    mounted.abort()
    await vi.waitFor(() => expect(held()).toBe(0))
    await show('hidden')
    await show('visible')
    expect(request).toHaveBeenCalledTimes(1)
  })
})
