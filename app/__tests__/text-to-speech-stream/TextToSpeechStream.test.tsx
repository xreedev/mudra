/**
 * Test-only text-to-speech streaming proof of concept.
 *
 * A production implementation needs a server-side credential boundary and a native audio player.
 * Neither API keys nor platform audio code are intentionally included in this test harness.
 *
 * Model: gpt-4o-mini-tts — OpenAI's dedicated natural-sounding TTS model.
 */
import React, { useMemo, useState } from 'react';
import { Button, StyleSheet, Text, TextInput, View } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { textToSpeechTestFont } from './textToSpeechTestFont';

const TTS_MODEL = 'gpt-4o-mini-tts';

type SpeechEvent =
  | { type: 'audio.delta'; base64Pcm16: string }
  | { type: 'audio.completed' }
  | { type: 'error'; message: string };

type SpeechRequest = {
  model: typeof TTS_MODEL;
  input: string;
  voice: 'coral';
  responseFormat: 'pcm';
  streamFormat: 'audio';
  instructions: string;
};

interface SpeechTransport {
  synthesize(request: SpeechRequest, onEvent: (event: SpeechEvent) => void): void;
  cancel(): void;
}

interface AudioPlayer {
  enqueuePcm16(base64Pcm16: string): void;
  finish(): void;
  stop(): void;
}

/** Converts text into progressively playable PCM frames without coupling to a player library. */
class StreamingSpeaker {
  constructor(
    private readonly transport: SpeechTransport,
    private readonly player: AudioPlayer,
    private readonly onState: (state: 'Speaking' | 'Complete') => void,
    private readonly onError: (message: string) => void,
  ) {}

  speak(input: string) {
    const text = input.trim();
    if (!text) {
      this.onError('Enter text before starting speech.');
      return;
    }

    this.onState('Speaking');
    this.transport.synthesize(
      {
        model: TTS_MODEL,
        input: text,
        voice: 'coral',
        responseFormat: 'pcm',
        streamFormat: 'audio',
        instructions: 'Speak clearly, warmly, and at an accessible conversational pace.',
      },
      event => {
        if (event.type === 'audio.delta') {
          this.player.enqueuePcm16(event.base64Pcm16);
        } else if (event.type === 'audio.completed') {
          this.player.finish();
          this.onState('Complete');
        } else {
          this.onError(event.message);
        }
      },
    );
  }

  stop() {
    this.transport.cancel();
    this.player.stop();
  }
}

function TextToSpeechTestScreen({ transport, player }: { transport: SpeechTransport; player: AudioPlayer }) {
  const [input, setInput] = useState('I need help.');
  const [state, setState] = useState<'Speaking' | 'Complete'>('Complete');
  const [error, setError] = useState('');
  const speaker = useMemo(
    () => new StreamingSpeaker(transport, player, setState, setError),
    [player, transport],
  );

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Text-to-speech test</Text>
      <Text accessibilityLabel="Model" style={styles.meta}>{TTS_MODEL}</Text>
      <TextInput accessibilityLabel="Text to speak" style={styles.input} value={input} onChangeText={setInput} />
      <Text accessibilityLabel="Speech status" style={styles.meta}>{state}</Text>
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
      <Button title="Start speech stream" onPress={() => speaker.speak(input)} />
      <Button title="Stop speech stream" onPress={() => speaker.stop()} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 20, gap: 12, backgroundColor: '#071C1A' },
  title: { color: '#E8FFF8', fontFamily: textToSpeechTestFont, fontSize: 22, fontWeight: '700' },
  input: { backgroundColor: '#FFFFFF', color: '#071C1A', fontFamily: textToSpeechTestFont, padding: 12 },
  meta: { color: '#8FD8C6', fontFamily: textToSpeechTestFont, fontSize: 13 },
});

class FakeSpeechTransport implements SpeechTransport {
  request?: SpeechRequest;
  isCancelled = false;
  private onEvent?: (event: SpeechEvent) => void;

  synthesize(request: SpeechRequest, onEvent: (event: SpeechEvent) => void) {
    this.request = request;
    this.onEvent = onEvent;
  }

  cancel() {
    this.isCancelled = true;
  }

  emit(event: SpeechEvent) {
    this.onEvent?.(event);
  }
}

class FakeAudioPlayer implements AudioPlayer {
  frames: string[] = [];
  didFinish = false;
  didStop = false;

  enqueuePcm16(base64Pcm16: string) {
    this.frames.push(base64Pcm16);
  }

  finish() {
    this.didFinish = true;
  }

  stop() {
    this.didStop = true;
  }
}

describe('test-only text-to-speech stream', () => {
  it('streams synthesized PCM frames to the audio-player boundary', () => {
    const transport = new FakeSpeechTransport();
    const player = new FakeAudioPlayer();
    render(<TextToSpeechTestScreen transport={transport} player={player} />);

    fireEvent.press(screen.getByText('Start speech stream'));
    expect(transport.request).toEqual({
      model: 'gpt-4o-mini-tts',
      input: 'I need help.',
      voice: 'coral',
      responseFormat: 'pcm',
      streamFormat: 'audio',
      instructions: 'Speak clearly, warmly, and at an accessible conversational pace.',
    });
    expect(screen.getByLabelText('Speech status').props.children).toBe('Speaking');

    act(() => transport.emit({ type: 'audio.delta', base64Pcm16: 'AAABAA==' }));
    act(() => transport.emit({ type: 'audio.delta', base64Pcm16: 'AgADAA==' }));
    expect(player.frames).toEqual(['AAABAA==', 'AgADAA==']);

    act(() => transport.emit({ type: 'audio.completed' }));
    expect(player.didFinish).toBe(true);
    expect(screen.getByLabelText('Speech status').props.children).toBe('Complete');

    fireEvent.press(screen.getByText('Stop speech stream'));
    expect(transport.isCancelled).toBe(true);
    expect(player.didStop).toBe(true);
  });

  it('does not invoke the transport when no text is supplied', () => {
    const transport = new FakeSpeechTransport();
    const player = new FakeAudioPlayer();
    render(<TextToSpeechTestScreen transport={transport} player={player} />);

    fireEvent.changeText(screen.getByLabelText('Text to speak'), '   ');
    fireEvent.press(screen.getByText('Start speech stream'));
    expect(transport.request).toBeUndefined();
    expect(screen.getByRole('alert').props.children).toBe('Enter text before starting speech.');
  });
});
