/** A single MediaPipe-compatible hand landmark. */
export interface HandLandmark {
  x: number;
  y: number;
  z: number;
}

export interface GestureTemplate {
  label: string;
  created_at?: string;
  hand_landmarks?: HandLandmark[];
  features: number[];
}

export interface GestureTemplateFile {
  schema: 'custom-gesture-snapshot-v1' | string;
  created_at?: string;
  description?: string;
  gestures: GestureTemplate[];
}

export interface GestureMatch {
  label: string;
  distance: number;
  isKnown: boolean;
  closestLabel?: string;
}
