import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

// A context the way Safari makes one: suspended until a tap resumes it.
class FakeAudioContext {
  static made = 0
  static resumes = 0
  // A browser without an audio device, whose resume never settles.
  static hangs = false
  state: AudioContextState = 'suspended'
  constructor() {
    FakeAudioContext.made++
  }
  resume() {
    FakeAudioContext.resumes++
    if (FakeAudioContext.hangs) return new Promise<void>(() => undefined)
    this.state = 'running'
    return Promise.resolve()
  }
  suspend() {
    this.state = 'suspended'
    return Promise.resolve()
  }
}

vi.stubGlobal('AudioContext', FakeAudioContext)
let document = new EventTarget()

// Each test starts from a new document that no tap has reached.
const load = async () => {
  document = new EventTarget()
  vi.stubGlobal('document', document)
  vi.resetModules()
  const audio = await import('../src/features/audio')
  audio.unlockAudio()
  return audio
}

const tap = () => document.dispatchEvent(new Event('pointerup'))

// Lets the context's promises settle.
const settle = () => vi.advanceTimersByTimeAsync(0)

describe('audio', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeAudioContext.made = 0
    FakeAudioContext.resumes = 0
    FakeAudioContext.hangs = false
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('plays nothing before the first tap, and makes no context for it', async () => {
    const { playSound } = await load()
    const play = vi.fn()
    playSound(play)
    await settle()
    expect(play).not.toHaveBeenCalled()
    expect(FakeAudioContext.made).toBe(0)
  })

  it('plays every sound outside a tap on the one context the first tap started', async () => {
    const { playSound } = await load()
    tap()
    tap()
    await settle()
    const contexts: unknown[] = []
    playSound((ctx) => contexts.push(ctx))
    playSound((ctx) => contexts.push(ctx))
    await settle()
    expect(FakeAudioContext.made).toBe(1)
    expect(contexts).toHaveLength(2)
    expect(contexts[0]).toBe(contexts[1])
  })

  it('rests the context between sounds, and leaves the taps after the first alone', async () => {
    const { playSound } = await load()
    tap()
    await settle()
    let context: FakeAudioContext | undefined
    playSound((ctx) => {
      context = ctx as unknown as FakeAudioContext
    })
    await settle()
    expect(context?.state).toBe('running')
    await vi.advanceTimersByTimeAsync(2000)
    expect(context?.state).toBe('suspended')

    const resumes = FakeAudioContext.resumes
    tap()
    tap()
    await settle()
    expect(FakeAudioContext.resumes).toBe(resumes)
  })

  it('asks a context that never starts only once, however many taps follow, and plays nothing on it', async () => {
    const { playSound } = await load()
    FakeAudioContext.hangs = true
    tap()
    tap()
    tap()
    await settle()
    expect(FakeAudioContext.resumes).toBe(1)
    const play = vi.fn()
    playSound(play)
    await settle()
    expect(play).not.toHaveBeenCalled()
  })
})
