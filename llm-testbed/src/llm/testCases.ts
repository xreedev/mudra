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

/**
 * A multi-turn pharmacy call, to exercise the rolling conversation-memory
 * window (buildRecentContext / appendTurn in features.ts) end-to-end rather
 * than a single static context string. Feed these in order via appendTurn(),
 * building smartReplies' context from buildRecentContext() at each step —
 * a later reply should stay consistent with earlier turns (e.g. still knows
 * which drug/strip count was asked for several turns back).
 */
export interface ConversationScript {
  id: string;
  turns: Array<{ speaker: 'caller' | 'callee'; text: string }>;
}

export const CONVERSATION_SCRIPTS: ConversationScript[] = [
  {
    id: 'pharmacy-multiturn',
    turns: [
      { speaker: 'caller', text: 'Hello, I need one strip of Metformin.' },
      { speaker: 'callee', text: 'Sure, do you have a prescription on file with us?' },
      { speaker: 'caller', text: 'Yes, I am coming.' },
      { speaker: 'callee', text: 'Great, we have it ready. Anything else you need today?' },
      // The next reply should stay about Metformin/pickup, not drift —
      // proves the window still carries the original topic 4 turns later.
    ],
  },
];

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
