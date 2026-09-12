type TtsModule = typeof import('react-native-tts');

let ttsModule: TtsModule | null | undefined;

/**
 * `react-native-tts` is loaded lazily and defensively, the same way `CameraStage` loads
 * `react-native-vision-camera`: a fresh clone has not run `pod install` or an Android build yet,
 * and the UI should stay reviewable even when the native module isn't linked.
 */
function loadTts(): TtsModule | null {
  if (ttsModule === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      ttsModule = require('react-native-tts') as TtsModule;
    } catch {
      ttsModule = null;
    }
  }
  return ttsModule;
}

export type SpeakingState = 'idle' | 'speaking' | 'unavailable';

/**
 * Speaks a confirmed sentence aloud through the device's own text-to-speech engine (iOS
 * `AVSpeechSynthesizer` / Android `TextToSpeech`). Nothing leaves the phone: unlike the
 * OpenAI-streaming proof of concept in `__tests__/text-to-speech-stream`, this needs no server
 * credential boundary, which is why it is what screens speak through.
 */
export class LocalSpeaker {
  private readonly module = loadTts();
  private initialized: Promise<void> | null = null;

  isAvailable(): boolean {
    return this.module !== null;
  }

  async speak(text: string, onStateChange: (state: SpeakingState) => void): Promise<void> {
    const tts = this.module?.default;
    if (!tts) {
      onStateChange('unavailable');
      return;
    }

    if (!this.initialized) {
      this.initialized = tts.getInitStatus().then(
        () => undefined,
        () => undefined,
      );
    }
    await this.initialized;

    tts.stop();
    tts.removeAllListeners('tts-finish');
    tts.removeAllListeners('tts-cancel');
    tts.addEventListener('tts-finish', () => onStateChange('idle'));
    tts.addEventListener('tts-cancel', () => onStateChange('idle'));

    onStateChange('speaking');
    tts.speak(text);
  }

  stop(): void {
    this.module?.default.stop();
  }
}
