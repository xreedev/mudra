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

export const DEMO_DRAFT = 'Hi, I am Safar';

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
