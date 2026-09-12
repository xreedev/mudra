import { LOCAL_WHISPER_MODEL_ASSET, LocalWhisperTranscriber } from '../src/speech/LocalWhisperTranscriber';
import { initWhisper } from 'whisper.rn';
import { RealtimeTranscriber } from 'whisper.rn/realtime-transcription';
import { AudioPcmStreamAdapter } from 'whisper.rn/realtime-transcription/adapters';

jest.mock('whisper.rn', () => ({ initWhisper: jest.fn() }), { virtual: true });
jest.mock(
  'whisper.rn/realtime-transcription',
  () => ({ RealtimeTranscriber: jest.fn() }),
  { virtual: true },
);
jest.mock(
  'whisper.rn/realtime-transcription/adapters',
  () => ({ AudioPcmStreamAdapter: jest.fn() }),
  { virtual: true },
);
jest.mock('react-native-fs', () => ({}));

const mockInitWhisper = initWhisper as jest.Mock;
const mockRealtimeTranscriber = RealtimeTranscriber as jest.Mock;
const mockAudioAdapter = AudioPcmStreamAdapter as jest.Mock;

describe('LocalWhisperTranscriber', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads the bundled local model and forwards local stream results', async () => {
    const context = { release: jest.fn(), transcribeData: jest.fn() };
    const start = jest.fn().mockResolvedValue(undefined);
    const stop = jest.fn().mockResolvedValue(undefined);
    const release = jest.fn().mockResolvedValue(undefined);
    let callbacks: { onTranscribe?: (event: { data?: { result?: string } }) => void } = {};

    mockInitWhisper.mockResolvedValue(context);
    mockAudioAdapter.mockImplementation(() => ({}));
    mockRealtimeTranscriber.mockImplementation((_: unknown, __: unknown, receivedCallbacks?: {
      onTranscribe?: (event: { data?: { result?: string } }) => void;
    }) => {
      callbacks = receivedCallbacks ?? {};
      return { start, stop, release };
    });

    const onTranscript = jest.fn();
    const transcriber = new LocalWhisperTranscriber();
    await transcriber.start({ onTranscript });

    expect(mockInitWhisper).toHaveBeenCalledWith({ filePath: LOCAL_WHISPER_MODEL_ASSET });
    expect(mockAudioAdapter).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);

    callbacks.onTranscribe?.({ data: { result: '  I need help.  ' } });
    expect(onTranscript).toHaveBeenCalledWith('I need help.');

    await transcriber.stop();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(context.release).toHaveBeenCalledTimes(1);
  });

  it('does not initialize a second microphone stream while already listening', async () => {
    const context = { release: jest.fn(), transcribeData: jest.fn() };
    mockInitWhisper.mockResolvedValue(context);
    mockAudioAdapter.mockImplementation(() => ({}));
    mockRealtimeTranscriber.mockImplementation(
      () => ({ start: jest.fn(), stop: jest.fn(), release: jest.fn() }),
    );

    const transcriber = new LocalWhisperTranscriber();
    await transcriber.start({ onTranscript: jest.fn() });
    await transcriber.start({ onTranscript: jest.fn() });

    expect(mockInitWhisper).toHaveBeenCalledTimes(1);
    await transcriber.stop();
  });
});
