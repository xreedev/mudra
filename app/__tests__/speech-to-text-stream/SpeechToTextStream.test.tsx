/**
 * Test-only streaming speech-to-text proof of concept.
 *
 * The production integration needs a server endpoint that mints short-lived credentials and a
 * native PCM16 microphone source. Neither belongs in this app test harness: an API key must
 * never be shipped in a React Native bundle.
 *
 * Model: gpt-live-transcribe — OpenAI's low-latency streaming transcription model.
 */
import React, { useMemo, useState } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { speechTestFont } from './speechTestFont';

const LIVE_TRANSCRIBE_MODEL = 'gpt-live-transcribe';

type TranscriptEvent =
  | { type: 'transcript.delta'; delta: string }
  | { type: 'transcript.completed'; text: string }
  | { type: 'error'; message: string };

type StreamConfiguration = {
  model: typeof LIVE_TRANSCRIBE_MODEL;
  audio: { encoding: 'pcm16'; sampleRateHz: 24000 };
  languageHints: string[];
  prompt: string;
};

interface TranscriptionTransport {
  connect(configuration: StreamConfiguration, onEvent: (event: TranscriptEvent) => void): void;
  appendAudio(base64Pcm16: string): void;
  close(): void;
}

/** Owns the streaming state so a future native microphone adapter remains a thin boundary. */
class StreamingTranscriber {
  private readonly configuration: StreamConfiguration = {
    model: LIVE_TRANSCRIBE_MODEL,
    audio: { encoding: 'pcm16', sampleRateHz: 24000 },
    languageHints: ['en', 'hi'],
    prompt: 'MUDRA accessibility and communication vocabulary.',
  };

  private partial = '';

  constructor(
    private readonly transport: TranscriptionTransport,
    private readonly onChange: (text: string, isFinal: boolean) => void,
    private readonly onError: (message: string) => void,
  ) {}

  start() {
    this.partial = '';
    this.transport.connect(this.configuration, event => {
      if (event.type === 'transcript.delta') {
        this.partial += event.delta;
        this.onChange(this.partial, false);
      } else if (event.type === 'transcript.completed') {
        this.partial = event.text;
        this.onChange(event.text, true);
      } else {
        this.onError(event.message);
      }
    });
  }

  /** A microphone adapter supplies base64-encoded 24 kHz mono PCM16 frames here. */
  pushPcm16(base64Pcm16: string) {
    this.transport.appendAudio(base64Pcm16);
  }

  stop() {
    this.transport.close();
  }
}

function SpeechToTextTestScreen({ transport }: { transport: TranscriptionTransport }) {
  const [transcript, setTranscript] = useState('');
  const [isFinal, setIsFinal] = useState(false);
  const [error, setError] = useState('');
  const transcriber = useMemo(
    () =>
      new StreamingTranscriber(
        transport,
        (text, final) => {
          setTranscript(text);
          setIsFinal(final);
        },
        setError,
      ),
    [transport],
  );

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Live transcription test</Text>
      <Text accessibilityLabel="Model" style={styles.meta}>
        {LIVE_TRANSCRIBE_MODEL}
      </Text>
      <Text accessibilityLabel="Transcript" style={styles.transcript}>
        {transcript || 'Waiting for speech…'}
      </Text>
      <Text accessibilityLabel="Transcript status" style={styles.meta}>
        {isFinal ? 'Final' : 'Listening'}
      </Text>
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
      <Button title="Start test stream" onPress={() => transcriber.start()} />
      <Button title="Send PCM16 test frame" onPress={() => transcriber.pushPcm16('AAABAA==')} />
      <Button title="Stop test stream" onPress={() => transcriber.stop()} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 20, gap: 12, backgroundColor: '#071C1A' },
  title: { color: '#E8FFF8', fontFamily: speechTestFont, fontSize: 22, fontWeight: '700' },
  transcript: { color: '#FFFFFF', fontFamily: speechTestFont, fontSize: 18, lineHeight: 26 },
  meta: { color: '#8FD8C6', fontFamily: speechTestFont, fontSize: 13 },
});

class FakeTranscriptionTransport implements TranscriptionTransport {
  configuration?: StreamConfiguration;
  frames: string[] = [];
  isClosed = false;
  private onEvent?: (event: TranscriptEvent) => void;

  connect(configuration: StreamConfiguration, onEvent: (event: TranscriptEvent) => void) {
    this.configuration = configuration;
    this.onEvent = onEvent;
  }

  appendAudio(base64Pcm16: string) {
    this.frames.push(base64Pcm16);
  }

  close() {
    this.isClosed = true;
  }

  emit(event: TranscriptEvent) {
    this.onEvent?.(event);
  }
}

describe('test-only live speech-to-text stream', () => {
  it('configures the high-quality streaming model and renders incremental then final text', () => {
    const transport = new FakeTranscriptionTransport();
    render(<SpeechToTextTestScreen transport={transport} />);

    fireEvent.press(screen.getByText('Start test stream'));
    expect(transport.configuration).toEqual({
      model: 'gpt-live-transcribe',
      audio: { encoding: 'pcm16', sampleRateHz: 24000 },
      languageHints: ['en', 'hi'],
      prompt: 'MUDRA accessibility and communication vocabulary.',
    });

    fireEvent.press(screen.getByText('Send PCM16 test frame'));
    expect(transport.frames).toEqual(['AAABAA==']);

    act(() => transport.emit({ type: 'transcript.delta', delta: 'I need ' }));
    act(() => transport.emit({ type: 'transcript.delta', delta: 'help' }));
    expect(screen.getByLabelText('Transcript').props.children).toBe('I need help');
    expect(screen.getByLabelText('Transcript status').props.children).toBe('Listening');

    act(() => transport.emit({ type: 'transcript.completed', text: 'I need help.' }));
    expect(screen.getByLabelText('Transcript').props.children).toBe('I need help.');
    expect(screen.getByLabelText('Transcript status').props.children).toBe('Final');

    fireEvent.press(screen.getByText('Stop test stream'));
    expect(transport.isClosed).toBe(true);
  });

  it('keeps a transport failure visible to the tester', () => {
    const transport = new FakeTranscriptionTransport();
    render(<SpeechToTextTestScreen transport={transport} />);
    fireEvent.press(screen.getByText('Start test stream'));

    act(() => transport.emit({ type: 'error', message: 'Network unavailable' }));
    expect(screen.getByRole('alert').props.children).toBe('Network unavailable');
  });
});
