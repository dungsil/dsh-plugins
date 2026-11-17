import type { Volume } from './preferences.ts'

const GAIN: Readonly<Record<Volume, number>> = { low: 0.05, medium: 0.12, high: 0.25 }

interface AudioContextLike {
  readonly state: string
  readonly currentTime: number
  readonly destination: AudioNode
  resume(): Promise<void>
  close(): Promise<void>
  createOscillator(): OscillatorNode
  createGain(): GainNode
}

/**
 * A short two-note chime synthesized with Web Audio, so the plugin ships no
 * audio asset. Browsers start audio only after a user gesture on the page;
 * `unlock` resumes the context from such a gesture.
 */
export function createChime(create: () => AudioContextLike) {
  let context: AudioContextLike | undefined
  const ensure = () => (context ??= create())
  return {
    unlock() {
      void ensure()
        .resume()
        .catch(() => undefined)
    },
    /** Resolve false when the browser keeps audio blocked or unavailable. */
    async play(volume: Volume): Promise<boolean> {
      try {
        const audio = ensure()
        if (audio.state !== 'running') await audio.resume()
        if (audio.state !== 'running') return false
        const start = audio.currentTime + 0.01
        for (const [offset, frequency] of [
          [0, 880],
          [0.14, 1318.5],
        ] as const) {
          const oscillator = audio.createOscillator()
          const gain = audio.createGain()
          oscillator.type = 'sine'
          oscillator.frequency.value = frequency
          gain.gain.setValueAtTime(0.0001, start + offset)
          gain.gain.exponentialRampToValueAtTime(GAIN[volume], start + offset + 0.02)
          gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.32)
          oscillator.connect(gain).connect(audio.destination)
          oscillator.start(start + offset)
          oscillator.stop(start + offset + 0.34)
        }
        return true
      } catch {
        return false
      }
    },
    dispose() {
      void context?.close().catch(() => undefined)
      context = undefined
    },
  }
}
