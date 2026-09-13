import { initWhisper, type WhisperContext } from 'whisper.rn';
import RNFS from 'react-native-fs';

/** Bundled multilingual Whisper tiny model. All inference happens on the device. */
export const LOCAL_WHISPER_MODEL_ASSET = require('../../assets/models/ggml-tiny.bin');

/**
 * whisper.rn@0.7.4 never compiles its realtime-transcription/adapters/ subpath into lib/ (only
 * the raw TS under src/ has it), and its package.json exports map — which would otherwise route
 * a subpath like this to that source — is only honored when Metro's unstable_enablePackageExports
 * is on, which this project's config leaves at Metro's own default of off. So the bare specifier
 * `whisper.rn/realtime-transcription/...` is unresolvable at runtime no matter how it's spelled,
 * and reaching into node_modules by relative path is the only shape Metro reliably resolves for
 * this still-source-only subpath.
 *
 * That raw source, though, isn't written to be `import`ed and type-checked as a dependency of our
 * own program the way a published package's `.d.ts` output is — it references bare Node globals
 * (`global`, `process`) our tsconfig has no ambient types for, which is invisible to Metro (it
 * doesn't type-check) but breaks `tsc --noEmit` the moment an `import` statement pulls the file
 * into TypeScript's module graph. A plain `require()` avoids that: unlike `import`, TypeScript
 * never opens or checks the target of a dynamic `require()` call, so the value comes back as
 * `any` and the local shape declared below is all that keeps this file honest.
 */
const realtimeTranscriptionModule = require('../../node_modules/whisper.rn/src/realtime-transcription');
const { AudioPcmStreamAdapter } = require('../../node_modules/whisper.rn/src/realtime-transcription/adapters/AudioPcmStreamAdapter');
const RealtimeTranscriber: RealtimeTranscriberConstructor = realtimeTranscriptionModule.RealtimeTranscriber;

/** Only the shape this file actually calls — see the require() comment above for why this isn't
 *  derived from whisper.rn's own (uncompiled-for-this-subpath) types. */
interface RealtimeTranscriberInstance {
  start(): Promise<void>;
  stop(): Promise<void>;
  release(): Promise<void>;
}

interface RealtimeTranscribeEventLike {
  data?: { result?: string };
}

interface RealtimeTranscriberConstructor {
  new (
    deps: { whisperContext: WhisperContext; audioStream: unknown; fs: unknown },
    options: {
      audioSliceSec: number;
      audioMinSec: number;
      initialPrompt: string;
      transcribeOptions: { language: string };
    },
    callbacks: {
      onTranscribe: (event: RealtimeTranscribeEventLike) => void;
      onStatusChange?: (isListening: boolean) => void;
      onError?: (message: string) => void;
    },
  ): RealtimeTranscriberInstance;
}

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
  private transcriber?: RealtimeTranscriberInstance;
  // Serializes start()/stop() against each other. initWhisper() + transcriber.start() take real
  // time (loading the model, spinning up the native audio stream) — without this, a stop() that
  // lands while a start() is still in that window would clear `context`/`transcriber` first,
  // and the start() call would then go on to finish and overwrite them with a fresh instance
  // nobody ever stops: the UI reports "listening" (whatever the last call set) but the actual
  // native mic stream from the orphaned start() is left running untracked, so nothing captured
  // afterwards ever reaches a live `transcriber` to be transcribed. Routing every call through
  // this chain makes start()s and stop()s run one at a time, in the order they were requested.
  private queue: Promise<void> = Promise.resolve();

  start(callbacks: LocalWhisperCallbacks, language = 'en'): Promise<void> {
    this.queue = this.queue.then(
      () => this.doStart(callbacks, language),
      () => this.doStart(callbacks, language),
    );
    return this.queue;
  }

  stop(): Promise<void> {
    this.queue = this.queue.then(
      () => this.doStop(),
      () => this.doStop(),
    );
    return this.queue;
  }

  private async doStart(callbacks: LocalWhisperCallbacks, language: string): Promise<void> {
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

  private async doStop(): Promise<void> {
    const transcriber = this.transcriber;
    const context = this.context;
    this.transcriber = undefined;
    this.context = undefined;

    await transcriber?.stop();
    await transcriber?.release();
    await context?.release();
  }
}
