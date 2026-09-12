/**
 * Declares only the subset of `react-native-tts` that `LocalSpeaker` consumes, mirroring
 * `whisper-rn.d.ts` — this lets the module be `require`d lazily and type-checked before it is
 * actually installed.
 */
declare module 'react-native-tts' {
  export type TtsEvent = 'tts-start' | 'tts-finish' | 'tts-cancel' | 'tts-error';

  interface Tts {
    getInitStatus(): Promise<void>;
    speak(text: string): void;
    stop(): void;
    addEventListener(event: TtsEvent, handler: (...args: unknown[]) => void): void;
    removeAllListeners(event: TtsEvent): void;
  }

  const tts: Tts;
  export default tts;
}
