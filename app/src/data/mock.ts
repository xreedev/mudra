/**
 * Placeholder content for the UI scaffold.
 *
 * Everything here is local and fake on purpose — this build is the design, not the pipeline.
 * When the real layers land, these shapes are what they should produce: the recognizer will
 * produce `tokens`.
 */

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

/** Sent once, automatically, the moment a call connects to an actual contact (not "Just
 *  practice") — so whoever picks up knows right away that what follows is sign-converted speech
 *  rather than a real voice. Never shown as the on-screen draft; it only ever goes out over the
 *  relay. */
export const CONNECT_INTRO_MESSAGE = 'This is a sign-language call — my phone speaks for me.';

export interface Contact {
  id: string;
  name: string;
  detail: string;
  emergency?: boolean;
}

export const SEED_CONTACTS: Contact[] = [
  { id: '1', name: 'Delivery 1', detail: 'Saved contact' },
  { id: '2', name: 'Delivery 2', detail: 'Saved contact' },
  { id: '3', name: 'Emergency services', detail: '108', emergency: true },
];
