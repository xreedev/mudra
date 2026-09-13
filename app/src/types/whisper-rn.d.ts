/**
 * whisper.rn exposes React Native entry points through package exports. TypeScript 5.0, used by
 * this app, cannot resolve that export map, so declare only the public API we consume.
 */
declare module 'whisper.rn' {
  export type WhisperContext = {
    transcribeData: (data: ArrayBuffer, options: { language?: string }) => unknown;
    transcribe: (
      filePathOrBase64: string | number,
      options?: { language?: string },
    ) => { stop: () => Promise<void>; promise: Promise<{ result: string }> };
    release: () => Promise<void>;
  };

  export function initWhisper(options: { filePath: string | number }): Promise<WhisperContext>;
}

declare module 'whisper.rn/realtime-transcription' {
  export class RealtimeTranscriber {
    constructor(dependencies: unknown, options?: unknown, callbacks?: {
      onTranscribe?: (event: { data?: { result?: string } }) => void;
      onStatusChange?: (isListening: boolean) => void;
      onError?: (message: string) => void;
    });
    start(): Promise<void>;
    stop(): Promise<void>;
    release(): Promise<void>;
  }
}

declare module 'whisper.rn/realtime-transcription/adapters' {
  export class AudioPcmStreamAdapter {}
}
