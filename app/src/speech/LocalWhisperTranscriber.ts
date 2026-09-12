import { initWhisper, type WhisperContext } from 'whisper.rn';
import { RealtimeTranscriber } from 'whisper.rn/realtime-transcription';
import { AudioPcmStreamAdapter } from 'whisper.rn/realtime-transcription/adapters';
import RNFS from 'react-native-fs';

/** Bundled multilingual Whisper tiny model. All inference happens on the device. */
export const LOCAL_WHISPER_MODEL_ASSET = require('../../assets/models/ggml-tiny.bin');

export type LocalWhisperCallbacks = {
  onTranscript: (text: string) => void;
  onListeningChange?: (isListening: boolean) => void;
  onError?: (message: string) => void;
};

/**
 * Owns the native Whisper context and microphone stream. No audio leaves the phone: the PCM
 * stream is sliced locally and Whisper transcribes each slice locally through whisper.cpp.
 */
export class LocalWhisperTranscriber {
  private context?: WhisperContext;
  private transcriber?: RealtimeTranscriber;

  async start(callbacks: LocalWhisperCallbacks, language = 'en'): Promise<void> {
    if (this.transcriber) {
      return;
    }

    this.context = await initWhisper({ filePath: LOCAL_WHISPER_MODEL_ASSET });
    const audioStream = new AudioPcmStreamAdapter();
    this.transcriber = new RealtimeTranscriber(
      { whisperContext: this.context, audioStream, fs: RNFS },
      {
        // Short local slices keep the UI responsive without a network round trip.
        audioSliceSec: 4,
        audioMinSec: 0.5,
        initialPrompt: 'MUDRA accessibility and communication vocabulary.',
        transcribeOptions: { language },
      },
      {
        onTranscribe: event => {
          const text = event.data?.result?.trim();
          if (text) {
            callbacks.onTranscript(text);
          }
        },
        onStatusChange: callbacks.onListeningChange,
        onError: callbacks.onError,
      },
    );

    await this.transcriber.start();
  }

  async stop(): Promise<void> {
    const transcriber = this.transcriber;
    const context = this.context;
    this.transcriber = undefined;
    this.context = undefined;

    await transcriber?.stop();
    await transcriber?.release();
    await context?.release();
  }
}
