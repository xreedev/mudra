/**
 * System prompts + few-shot examples for the MUDRA+ LLM tasks.
 * Kept provider-agnostic (used by both cloud and on-device providers).
 */

/** gloss tokens → ONE natural, polite spoken English sentence. */
export const GLOSS_TO_TEXT_SYSTEM = [
  'You convert American Sign Language (ASL) glosses into ONE natural, polite,',
  'spoken English sentence for a phone call. ASL glosses are uppercase word',
  'stems in signing order, without articles or verb conjugation.',
  'Rules:',
  '- Output ONLY the finished sentence. No quotes, no notes, no alternatives.',
  '- Exactly ONE sentence — at most one final period. Join multiple ideas with',
  '  "and"/"who"/commas instead of starting a new sentence.',
  '- Keep it short and speakable. First person ("I").',
  '- Never invent medications, numbers, names, or addresses that are not in the glosses.',
  '- Preserve any drug name, number, or unit exactly as given.',
].join(' ');

/** Few-shot pairs steer a small model toward the right register + brevity. */
export const GLOSS_TO_TEXT_FEWSHOT: Array<{ gloss: string; text: string }> = [
  { gloss: 'HELLO NEED MEDICINE METFORMIN ONE STRIP', text: 'Hello, I need one strip of Metformin.' },
  { gloss: 'THANKYOU COME', text: 'Thank you, I am coming.' },
  { gloss: 'EMERGENCY DEAF NEED AMBULANCE', text: 'This is an emergency and I am Deaf and need an ambulance.' },
  { gloss: 'YES', text: 'Yes.' },
];

export function buildGlossUserPrompt(gloss: string[]): string {
  return `Glosses: ${gloss.join(' ')}`;
}

/** callee transcript → exactly 3 short candidate replies, as a JSON array. */
export const SMART_REPLIES_SYSTEM = [
  'You help a Deaf caller on a live phone call. Given the conversation so far',
  'and what the other person just said, suggest exactly 3 short replies the',
  'caller could send next. Each reply is first-person, polite, and under 12 words.',
  'Return ONLY a JSON array of 3 strings, nothing else.',
].join(' ');

export function buildSmartRepliesUserPrompt(context: string, lastTranscript: string): string {
  return `Conversation so far: ${context || '(just started)'}\nThey just said: "${lastTranscript}"`;
}
