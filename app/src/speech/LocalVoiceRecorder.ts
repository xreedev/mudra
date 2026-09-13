import { initWhisper, type WhisperContext } from 'whisper.rn';
import RNFS from 'react-native-fs';
import { LOCAL_WHISPER_MODEL_ASSET } from './LocalWhisperTranscriber';

// Same "require the uncompiled TS subpath by relative path" situation as
// LocalWhisperTranscriber.ts — see the comment there for why. WavFileWriter
// lives in the same source-only utils/ directory.
const { WavFileWriter } = require('../../node_modules/whisper.rn/src/utils/WavFileWriter');
const { AudioPcmStreamAdapter } = require('../../node_modules/whisper.rn/src/realtime-transcription/adapters/AudioPcmStreamAdapter');

/** Only the shape this file actually calls — see the require() comment above. */
interface AudioStreamDataLike {
  data: Uint8Array;
}
interface AudioStreamAdapterInstance {
  initialize(config: { sampleRate: number; channels: number; bitsPerSample: number }): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  release(): Promise<void>;
  onData(callback: (data: AudioStreamDataLike) => void): void;
  onError(callback: (error: string) => void): void;
}
interface WavFileWriterInstance {
  initialize(): Promise<void>;
  appendAudioData(data: Uint8Array): Promise<void>;
  finalize(): Promise<void>;
  cancel(): Promise<void>;
}

const AUDIO_CONFIG = { sampleRate: 16000, channels: 1, bitsPerSample: 16 };

/** RMS amplitude of a raw 16-bit PCM chunk, normalized to 0-1 against the full Int16 range. */
function rmsLevel(pcmBytes: Uint8Array): number {
  const sampleCount = Math.floor(pcmBytes.length / 2);
  if (sampleCount === 0) return 0;

  let sumSquares = 0;
  for (let i = 0; i < sampleCount; i++) {
    // Little-endian signed 16-bit.
    let sample = pcmBytes[i * 2] | (pcmBytes[i * 2 + 1] << 8);
    if (sample >= 0x8000) sample -= 0x10000;
    sumSquares += sample * sample;
  }
  const rms = Math.sqrt(sumSquares / sampleCount);
  return Math.min(1, rms / 32768);
}

/**
 * Records one voice message at a time and transcribes it ONCE, after the recording stops —
 * deliberately not the always-on sliding-window model `LocalWhisperTranscriber` uses.
 *
 * That continuous model transcribes every ~4s audio slice independently with no idea whether
 * the previous slice already covered the same words, so one sentence spoken across multiple
 * slices (or lingering in a slice after a pause) surfaces as 2-3 near-duplicate `onTranscript`
 * calls for what was really one utterance — a real bug observed on the Receive screen. A single
 * record-then-transcribe pass has no slice boundary to duplicate across: there's exactly one
 * Whisper call per message, so there's exactly one result.
 */
export interface VoiceRecorderStats {
  /** Number of onData chunks received from the native audio stream since start(). Staying at 0
   *  for the whole recording means no audio ever arrived from the mic at all (permission/native
   *  stream problem) — a non-zero count with a near-silent level means the stream is open but
   *  not picking up voice (wrong audio source, muted input, mic blocked, etc). */
  chunkCount: number;
  totalBytes: number;
  /** 0-1, RMS of the most recent chunk against full Int16 range. */
  lastLevel: number;
  /** Highest `lastLevel` seen this recording — the actual peak, not just the latest sample. */
  peakLevel: number;
}

export class LocalVoiceRecorder {
  private context?: WhisperContext;
  private audioStream?: AudioStreamAdapterInstance;
  private wavWriter?: WavFileWriterInstance;
  private filePath?: string;
  private recording = false;
  private stats: VoiceRecorderStats = { chunkCount: 0, totalBytes: 0, lastLevel: 0, peakLevel: 0 };
  private onLevel?: (stats: VoiceRecorderStats) => void;
  // Serializes start()/stop() against each other, same reasoning as LocalWhisperTranscriber's
  // queue — initWhisper() and the native audio stream setup both take real time.
  private queue: Promise<unknown> = Promise.resolve();

  isRecording(): boolean {
    return this.recording;
  }

  getStats(): VoiceRecorderStats {
    return this.stats;
  }

  /** `onLevel` fires on every audio chunk while recording, so the UI can show a live level
   *  meter and confirm audio is actually arriving, not just guess from the end result. */
  start(onLevel?: (stats: VoiceRecorderStats) => void): Promise<void> {
    this.onLevel = onLevel;
    const next = this.queue.then(() => this.doStart(), () => this.doStart());
    this.queue = next;
    return next;
  }

  /** Resolves with the transcribed text, or '' if nothing usable was said/captured. */
  stop(): Promise<string> {
    const next = this.queue.then(() => this.doStop(), () => this.doStop());
    this.queue = next;
    return next;
  }

  /** Drops anything recorded so far with no transcription — e.g. the user backed out mid-recording. */
  cancel(): Promise<void> {
    const next = this.queue.then(() => this.doCancel(), () => this.doCancel());
    this.queue = next.then(() => undefined);
    return next.then(() => undefined);
  }

  async release(): Promise<void> {
    await this.queue.catch(() => undefined);
    if (this.recording) {
      await this.doCancel();
    }
    await this.context?.release();
    this.context = undefined;
  }

  private async doStart(): Promise<void> {
    if (this.recording) return;

    this.stats = { chunkCount: 0, totalBytes: 0, lastLevel: 0, peakLevel: 0 };

    if (!this.context) {
      this.context = await initWhisper({ filePath: LOCAL_WHISPER_MODEL_ASSET });
    }

    this.filePath = `${RNFS.CachesDirectoryPath}/voice-message-${Date.now()}.wav`;
    this.wavWriter = new WavFileWriter(RNFS, this.filePath, AUDIO_CONFIG);
    await this.wavWriter!.initialize();

    this.audioStream = new AudioPcmStreamAdapter();
    await this.audioStream!.initialize(AUDIO_CONFIG);
    this.audioStream!.onError(() => undefined);
    this.audioStream!.onData((chunk) => {
      this.wavWriter?.appendAudioData(chunk.data).catch(() => undefined);

      const level = rmsLevel(chunk.data);
      this.stats = {
        chunkCount: this.stats.chunkCount + 1,
        totalBytes: this.stats.totalBytes + chunk.data.length,
        lastLevel: level,
        peakLevel: Math.max(this.stats.peakLevel, level),
      };
      this.onLevel?.(this.stats);
    });
    await this.audioStream!.start();

    this.recording = true;
  }

  private async doStop(): Promise<string> {
    if (!this.recording) return '';
    this.recording = false;

    await this.audioStream?.stop();
    await this.audioStream?.release();
    this.audioStream = undefined;

    await this.wavWriter?.finalize();
    const path = this.filePath;
    this.filePath = undefined;
    this.wavWriter = undefined;

    const context = this.context;
    if (!path || !context) return '';

    try {
      const { promise } = context.transcribe(path, { language: 'en' });
      const result = await promise;
      return result.result?.trim() ?? '';
    } finally {
      RNFS.unlink(path).catch(() => undefined);
    }
  }

  private async doCancel(): Promise<void> {
    if (!this.recording) return;
    this.recording = false;

    await this.audioStream?.stop();
    await this.audioStream?.release();
    this.audioStream = undefined;

    await this.wavWriter?.cancel();
    this.wavWriter = undefined;
    this.filePath = undefined;
  }
}
