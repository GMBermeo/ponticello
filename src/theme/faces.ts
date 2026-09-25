import { Platform, type TextStyle } from 'react-native';

export type FaceName = 'regular' | 'semibold' | 'heavy' | 'rounded';

/**
 * Type faces, per platform.
 *
 * On iOS the interface is set in the system face — SF Pro for text and SF Pro
 * Rounded for numbers and the big display glyphs — so the app reads as part of
 * the phone rather than a port. Elsewhere it stays in Archivo, bundled, whose
 * weights are separate families and so need no `fontWeight`.
 *
 * A face is a style fragment rather than a family name: spread it into a text
 * style (`...FACE.heavy`) and the weight travels with it. Kept out of
 * `tokens.ts` so that file stays importable from the plain-Node tests.
 */
const FACE_IOS: Record<FaceName, TextStyle> = {
  regular: { fontFamily: 'system-ui', fontWeight: '400' },
  semibold: { fontFamily: 'system-ui', fontWeight: '600' },
  heavy: { fontFamily: 'system-ui', fontWeight: '700' },
  rounded: { fontFamily: 'ui-rounded', fontWeight: '700' },
};

const FACE_ARCHIVO: Record<FaceName, TextStyle> = {
  regular: { fontFamily: 'Archivo_400Regular' },
  semibold: { fontFamily: 'Archivo_600SemiBold' },
  heavy: { fontFamily: 'Archivo_800ExtraBold' },
  rounded: { fontFamily: 'Archivo_800ExtraBold' },
};

export const FACE: Record<FaceName, TextStyle> = Platform.OS === 'ios' ? FACE_IOS : FACE_ARCHIVO;
