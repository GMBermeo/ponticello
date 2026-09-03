import { describe, expect, it } from 'vitest';

import { envelopeAt, envelopeHeldLevel, VOICES } from '../voices';

const SR = 22_050;

function samples(ms: number): number {
  return Math.max(1, (ms / 1000) * SR);
}

describe('ADSR continuity', () => {
  it.each(Object.entries(VOICES))(
    '%s releases from the level reached at note-off',
    (_name, voice) => {
      const attack = samples(voice.attackMs);
      const decay = samples(voice.decayMs);
      const release = samples(voice.releaseMs);

      // Exercise note-off during attack, during decay, and during sustain.
      for (const held of [
        Math.max(1, Math.floor(attack / 2)),
        Math.floor(attack + decay / 2),
        Math.floor(attack + decay + SR / 10),
      ]) {
        const before = envelopeAt(held - 1, attack, decay, voice.sustain, held, release);
        const after = envelopeAt(held, attack, decay, voice.sustain, held, release);
        const naturalStep = Math.max(1 / attack, Math.abs(1 - voice.sustain) / decay) + 1e-6;

        expect(after).toBeCloseTo(envelopeHeldLevel(held, attack, decay, voice.sustain), 8);
        expect(Math.abs(after - before)).toBeLessThanOrEqual(naturalStep);
      }
    },
  );

  it('evaluates the same envelope correctly in Web Audio seconds', () => {
    const voice = VOICES.piano;
    const attack = voice.attackMs / 1000;
    const decay = voice.decayMs / 1000;
    const release = voice.releaseMs / 1000;

    expect(envelopeHeldLevel(attack / 2, attack, decay, voice.sustain)).toBeCloseTo(0.5, 8);
    expect(envelopeHeldLevel(attack + decay / 2, attack, decay, voice.sustain))
      .toBeCloseTo(1 + (voice.sustain - 1) / 2, 8);
    expect(envelopeHeldLevel(1, attack, decay, voice.sustain)).toBeCloseTo(voice.sustain, 8);

    const releaseLevel = envelopeAt(1.1, attack, decay, voice.sustain, 1, release);
    expect(releaseLevel).toBeCloseTo(voice.sustain * (1 - 0.1 / release), 8);
  });

  it('does not drop a short piano note from decay level straight to sustain', () => {
    const voice = VOICES.piano;
    const attack = samples(voice.attackMs);
    const decay = samples(voice.decayMs);
    const release = samples(voice.releaseMs);
    const held = Math.floor(0.3 * SR);

    const before = envelopeAt(held - 1, attack, decay, voice.sustain, held, release);
    const after = envelopeAt(held, attack, decay, voice.sustain, held, release);
    expect(Math.abs(after - before)).toBeLessThan(0.001);
  });
});
