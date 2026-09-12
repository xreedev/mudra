/**
 * Placeholder content for the UI scaffold.
 *
 * Everything here is local and fake on purpose — this build is the design, not the pipeline.
 * When the real layers land, these shapes are what they should produce: `memory-layer-rn`
 * already returns `MemoryPair`-shaped records, and the recognizer will produce `tokens`.
 */

export interface MemoryPair {
  id: string;
  /** Canonical gloss sequence, one entry per sign. */
  tokens: string[];
  /** The English sentence the user confirmed for that sequence. */
  sentence: string;
  useCount: number;
  pinned: boolean;
}

export const SEED_MEMORIES: MemoryPair[] = [
  {
    id: '1',
    tokens: ['ME', 'TEA', 'HOT'],
    sentence: 'I want hot tea',
    useCount: 12,
    pinned: false,
  },
  {
    id: '2',
    tokens: ['ME', 'NEED', 'METFORMIN', 'ONE', 'STRIP'],
    sentence: 'I need one strip of Metformin, please',
    useCount: 8,
    pinned: true,
  },
  {
    id: '3',
    tokens: ['HELP', 'AMBULANCE', 'NOW'],
    sentence: "I'm Deaf. I need an ambulance now.",
    useCount: 2,
    pinned: true,
  },
  {
    id: '4',
    tokens: ['THANK_YOU', 'BYE'],
    sentence: 'Thank you, goodbye',
    useCount: 21,
    pinned: false,
  },
  {
    id: '5',
    tokens: ['ME', 'COME', 'LATER'],
    sentence: "I'll come by later today",
    useCount: 4,
    pinned: false,
  },
];

export interface CustomSign {
  id: string;
  label: string;
  samples: number;
}

export const SEED_SIGNS: CustomSign[] = [
  { id: '1', label: 'METFORMIN', samples: 24 },
  { id: '2', label: 'PHARMACY', samples: 18 },
  { id: '3', label: 'AMBULANCE', samples: 30 },
];

export interface ChatMessage {
  id: string;
  author: 'user' | 'assistant';
  body: string;
  time: string;
}

export const SEED_CHAT: ChatMessage[] = [
  {
    id: '1',
    author: 'assistant',
    body: 'Hi. Ask me anything, or sign it — I can help you phrase what you want to say on a call.',
    time: '09:14',
  },
  {
    id: '2',
    author: 'user',
    body: 'I need to ask the pharmacy if my prescription is ready',
    time: '09:15',
  },
  {
    id: '3',
    author: 'assistant',
    body: 'Try: "Hello, this is a call through an assistant. Is the prescription for Metformin ready for collection?"',
    time: '09:15',
  },
];

/** The gloss sequence the call screen shows as "just recognized". */
export const DEMO_RECOGNIZED = ['ME', 'NEED', 'METFORMIN', 'ONE', 'STRIP'];
export const DEMO_DRAFT = 'I need one strip of Metformin, please';

export interface Contact {
  id: string;
  name: string;
  detail: string;
  emergency?: boolean;
}

export const SEED_CONTACTS: Contact[] = [
  { id: '1', name: 'Apollo Pharmacy', detail: 'Nearby · saved' },
  { id: '2', name: 'Dr. Meera Raghavan', detail: 'Clinic' },
  { id: '3', name: 'Emergency services', detail: '108', emergency: true },
];
