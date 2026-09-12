import {
  appendTurn,
  buildRecentContext,
  glossToText,
  glossToTextOptions,
  parseReplies,
  smartReplies,
  type ConversationTurn,
} from '..';
import type { LlmProvider } from '../LlmProvider';

/** A fake provider — proves the prompt-building/call shape works without
 *  needing real inference (that's what the llm-testbed already verified
 *  end-to-end on-device: 850ms avg, 12.1-12.5 tok/s, all budgets cleared). */
function fakeLlm(response: string): LlmProvider {
  return {
    async ready() {
      return true;
    },
    async complete() {
      return response;
    },
  };
}

describe('glossToText', () => {
  it('calls the provider and returns its response verbatim', async () => {
    const llm = fakeLlm('I need one strip of Metformin.');
    const result = await glossToText(llm, ['NEED', 'MEDICINE', 'METFORMIN', 'ONE', 'STRIP']);
    expect(result).toBe('I need one strip of Metformin.');
  });
});

describe('glossToTextOptions', () => {
  it('parses 3 candidate sentences from a clean JSON array', async () => {
    const llm = fakeLlm(
      JSON.stringify([
        'Have you arrived home, right or left?',
        "I've reached your home — is it on the right or the left?",
        'Have you arrived, right or left?',
      ]),
    );
    const options = await glossToTextOptions(llm, ['ARRIVED', 'HOME', 'RIGHT', 'LEFT']);
    expect(options).toHaveLength(3);
    expect(options[0]).toBe('Have you arrived home, right or left?');
  });

  it('recovers via the same tolerant parser when the model returns malformed JSON', async () => {
    const llm = fakeLlm('["Where is your home?"]["Which way to your home?"]');
    const options = await glossToTextOptions(llm, ['WHERE', 'HOME']);
    expect(options).toEqual(['Where is your home?', 'Which way to your home?']);
  });
});

describe('smartReplies', () => {
  it('parses a clean JSON array response', async () => {
    const llm = fakeLlm('["Yes, when can I come?", "Can I come in now?"]');
    const replies = await smartReplies(llm, 'context', 'Do you want to pick it up today?');
    expect(replies).toEqual(['Yes, when can I come?', 'Can I come in now?']);
  });
});

describe('parseReplies', () => {
  it('parses a clean JSON array', () => {
    expect(parseReplies('["a", "b", "c"]')).toEqual(['a', 'b', 'c']);
  });

  it('recovers quoted strings from multiple malformed arrays', () => {
    // Real failure mode hit during on-device testing: a small model
    // emitting several separate arrays instead of one.
    expect(parseReplies('["a"]["b"]["c"]')).toEqual(['a', 'b', 'c']);
  });

  it('falls back to line-based recovery when nothing is quoted', () => {
    expect(parseReplies('1. Yes\n2. No\n3. Maybe')).toEqual(['Yes', 'No', 'Maybe']);
  });

  it('caps at 3 replies', () => {
    expect(parseReplies('["a","b","c","d","e"]')).toEqual(['a', 'b', 'c']);
  });
});

describe('conversation memory', () => {
  it('appendTurn returns a new array without mutating the original', () => {
    const turns: ConversationTurn[] = [];
    const next = appendTurn(turns, 'caller', 'Hello');
    expect(turns).toHaveLength(0);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ speaker: 'caller', text: 'Hello' });
  });

  it('buildRecentContext formats the tail as Caller/Callee lines', () => {
    let turns: ConversationTurn[] = [];
    turns = appendTurn(turns, 'caller', 'I need one strip of Metformin.');
    turns = appendTurn(turns, 'callee', 'Sure, do you have a prescription?');
    const context = buildRecentContext(turns);
    expect(context).toBe(
      'Caller: I need one strip of Metformin.\nCallee: Sure, do you have a prescription?',
    );
  });

  it('buildRecentContext only keeps the last maxTurns entries', () => {
    let turns: ConversationTurn[] = [];
    for (let i = 0; i < 10; i++) turns = appendTurn(turns, 'caller', `turn ${i}`);
    const context = buildRecentContext(turns, { maxTurns: 3 });
    expect(context.split('\n')).toHaveLength(3);
    expect(context).toContain('turn 9');
    expect(context).not.toContain('turn 6');
  });

  it('buildRecentContext trims from the oldest end to fit maxChars', () => {
    let turns: ConversationTurn[] = [];
    turns = appendTurn(turns, 'caller', 'a'.repeat(300));
    turns = appendTurn(turns, 'callee', 'b'.repeat(300));
    const context = buildRecentContext(turns, { maxChars: 350 });
    // Only the most recent (callee) line should survive the trim.
    expect(context).toContain('b'.repeat(300));
    expect(context).not.toContain('a'.repeat(300));
  });
});
