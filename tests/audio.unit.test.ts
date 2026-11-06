import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

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
}

const document = new EventTarget()
vi.stubGlobal('document', document)
vi.stubGlobal('AudioContext', FakeAudioContext)

const { playSound, unlockAudio } = await import('../src/features/audio')
unlockAudio()

const tap = () => document.dispatchEvent(new Event('pointerup'))

describe('audio', () => {
  beforeEach(() => {
    FakeAudioContext.made = 0
    FakeAudioContext.resumes = 0
  })

  it('plays nothing before the first tap, and makes no context for it', () => {
    const play = vi.fn()
    playSound(play)
    expect(play).not.toHaveBeenCalled()
    expect(FakeAudioContext.made).toBe(0)
  })

  it('plays every sound on the one context a tap made, outside any tap too', () => {
    tap()
    tap()
    const contexts: unknown[] = []
    playSound((ctx) => contexts.push(ctx))
    playSound((ctx) => contexts.push(ctx))
    expect(FakeAudioContext.made).toBe(1)
    expect(contexts).toHaveLength(2)
    expect(contexts[0]).toBe(contexts[1])
  })

  it('skips a sound while the browser keeps the context suspended, and plays again after the next tap', async () => {
    tap()
    let context: FakeAudioContext | undefined
    playSound((ctx) => {
      context = ctx as unknown as FakeAudioContext
    })
    // The app left the screen, and Safari suspended the context.
    context!.state = 'suspended'
    const play = vi.fn()
    playSound(play)
    expect(play).not.toHaveBeenCalled()

    tap()
    await Promise.resolve()
    playSound(play)
    expect(play).toHaveBeenCalledOnce()
  })

  it('asks a context that never wakes only once, however many taps follow', async () => {
    let context: FakeAudioContext | undefined
    playSound((ctx) => {
      context = ctx as unknown as FakeAudioContext
    })
    context!.state = 'suspended'
    FakeAudioContext.hangs = true
    tap()
    tap()
    tap()
    await Promise.resolve()
    expect(FakeAudioContext.resumes).toBe(1)
    FakeAudioContext.hangs = false
  })
})
