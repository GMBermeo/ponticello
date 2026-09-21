import { describe, expect, it } from 'vitest';

import {
  alpha,
  APPLE_HIG,
  CHROMES,
  ChromeName,
  intonationColor,
  MENU_CHROME,
} from '../tokens';

describe('theme chrome tokens', () => {
  const themes: ChromeName[] = ['paper', 'quiet', 'neon'];

  it('provides complete chromes for paper, quiet, and neon', () => {
    for (const name of themes) {
      const chrome = CHROMES[name];
      expect(chrome).toBeDefined();
      expect(chrome.name).toBe(name);
      expect(chrome.bg).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(chrome.surface).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(chrome.surfaceElevated).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(chrome.ink).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(chrome.dim).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(chrome.line).toBeDefined();
      expect(chrome.lineSoft).toBeDefined();
      expect(chrome.accent).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('accurately identifies dark vs light themes', () => {
    expect(CHROMES.paper.dark).toBe(false);
    expect(CHROMES.quiet.dark).toBe(true);
    expect(CHROMES.neon.dark).toBe(true);
  });

  it('provides higher contrast lines in dark modes', () => {
    expect(CHROMES.quiet.lineSoft).toContain('0.22');
    expect(CHROMES.neon.lineSoft).toContain('0.20');
  });

  it('maps string colors to all four cello strings with Apple HIG vibrancy', () => {
    const strings = ['C', 'G', 'D', 'A'] as const;
    for (const name of themes) {
      const chrome = CHROMES[name];
      for (const s of strings) {
        expect(chrome.strings[s]).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
    // C is green, G is red, D is blue, A is yellow
    expect(CHROMES.paper.strings.C).toBe(APPLE_HIG.green.accessibleLight);
    expect(CHROMES.paper.strings.G).toBe(APPLE_HIG.red.accessibleLight);
    expect(CHROMES.paper.strings.D).toBe(APPLE_HIG.blue.accessibleLight);
    expect(CHROMES.paper.strings.A).toBe(APPLE_HIG.yellow.accessibleLight);

    expect(CHROMES.quiet.strings.C).toBe(APPLE_HIG.green.dark);
    expect(CHROMES.quiet.strings.G).toBe(APPLE_HIG.red.dark);
    expect(CHROMES.quiet.strings.D).toBe(APPLE_HIG.blue.dark);
    expect(CHROMES.quiet.strings.A).toBe(APPLE_HIG.yellow.dark);
  });

  it('selects intonation colors with proper Apple HIG contrast', () => {
    const light = CHROMES.paper;
    const dark = CHROMES.quiet;

    expect(intonationColor('perfect', light)).toBe(APPLE_HIG.green.accessibleLight);
    expect(intonationColor('perfect', dark)).toBe(APPLE_HIG.green.dark);

    expect(intonationColor('flat', light)).toBe(APPLE_HIG.orange.accessibleLight);
    expect(intonationColor('flat', dark)).toBe(APPLE_HIG.yellow.dark);

    expect(intonationColor('miss', light)).toBe(light.accent);
    expect(intonationColor('miss', dark)).toBe(dark.accent);
  });

  it('computes correct alpha rgba strings from hex codes', () => {
    expect(alpha('#ffffff', 0.5)).toBe('rgba(255, 255, 255, 0.5)');
    expect(alpha('#000000', 0.25)).toBe('rgba(0, 0, 0, 0.25)');
    expect(alpha('#007AFF', 0.1)).toBe('rgba(0, 122, 255, 0.1)');
  });

  it('uses paper as default menu chrome', () => {
    expect(MENU_CHROME.name).toBe('paper');
  });
});
