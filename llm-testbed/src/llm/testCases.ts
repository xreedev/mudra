/**
 * Fixture gloss→sentence cases and smart-reply prompts drawn from the MUDRA+
 * pharmacy and emergency demo flows (PLAN.md §Data flow, TRAINING.md §2 vocab).
 * Used to eyeball quality and to drive the batch benchmark in the testbed.
 */
export interface GlossCase {
  id: string;
  gloss: string[];
  category: 'pharmacy' | 'emergency' | 'greeting' | 'general';
  /** Rough expectation for a human to compare against (not an exact assert). */
  expectContains: string[];
}

export const GLOSS_CASES: GlossCase[] = [
  { id: 'greeting', gloss: ['HELLO'], category: 'greeting', expectContains: ['hello', 'hi'] },
  {
    id: 'pharmacy-metformin',
    gloss: ['NEED', 'MEDICINE', 'METFORMIN', 'ONE', 'STRIP'],
    category: 'pharmacy',
    expectContains: ['metformin', 'strip'],
  },
  {
    id: 'coming',
    gloss: ['THANKYOU', 'COME'],
    category: 'greeting',
    expectContains: ['thank', 'coming'],
  },
  {
    id: 'emergency-ambulance',
    gloss: ['EMERGENCY', 'DEAF', 'NEED', 'AMBULANCE'],
    category: 'emergency',
    expectContains: ['ambulance', 'deaf', 'emergency'],
  },
  {
    id: 'pain',
    gloss: ['HELP', 'PAIN'],
    category: 'emergency',
    expectContains: ['pain', 'help'],
  },
  { id: 'yes', gloss: ['YES'], category: 'general', expectContains: ['yes'] },
];

export interface ReplyCase {
  id: string;
  context: string;
  lastTranscript: string;
}

export const REPLY_CASES: ReplyCase[] = [
  {
    id: 'pharmacy-stock',
    context: 'Caller asked for one strip of Metformin.',
    lastTranscript: 'Yes we have that in stock, do you want to pick it up today?',
  },
  {
    id: 'emergency-address',
    context: 'Caller reported an emergency and that they are Deaf.',
    lastTranscript: 'Help is on the way. Can you confirm your address?',
  },
];
