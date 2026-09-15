/**
 * A single, cello-specific arrangement boundary for every MIDI entry path.
 *
 * Source selection asks which part carries the recognisable material; range
 * fitting moves that line bodily by octaves before repairing true outliers;
 * difficulty reduction keeps rhythmic/motif anchors rather than every Nth
 * event; and fingering happens only after those musical decisions are final.
 *
 * Pure: no React, no React Native. See AGENTS.md.
 */

export * from './arranger';
