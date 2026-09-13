import { parseGestureTemplates } from './gestureRecognizer';
import type { GestureTemplate } from './types';

// Metro bundles this data with the app, so recognition works offline and needs no file permission.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const templateFile: unknown = require('../assets/delivery.json');
export const BUNDLED_GESTURE_TEMPLATES: GestureTemplate[] = parseGestureTemplates(templateFile);
