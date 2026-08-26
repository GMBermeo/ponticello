import React from 'react';
import { View } from 'react-native';

import {
  ACCOMPANIMENT_BLURB, ACCOMPANIMENT_LABEL, AccompanimentStyle, BackingPart,
} from '@/domain/backing';
import { LISTEN_BLURB, LISTEN_LABEL, ListenMode } from '@/audio/backing/types';
import { useTheme } from '@/theme/ThemeProvider';
import { Segmented, Stepper } from '../ui/controls';
import { Body, Grow, Label, Num, Row, Rule, Stack } from '../ui/primitives';

const LISTEN_SEGMENTS: { value: ListenMode; label: string; hint: string }[] =
  (['off', 'backing', 'solo', 'both'] as const).map((value) => ({
    value,
    label: LISTEN_LABEL[value].toUpperCase(),
    hint: LISTEN_BLURB[value],
  }));

const STYLE_SEGMENTS: { value: AccompanimentStyle; label: string }[] =
  (['none', 'drone', 'chords', 'pulse'] as const).map((value) => ({
    value,
    label: ACCOMPANIMENT_LABEL[value].toUpperCase(),
  }));

export interface ListenControlProps {
  mode: ListenMode;
  onModeChange: (mode: ListenMode) => void;
  style: AccompanimentStyle;
  onStyleChange: (style: AccompanimentStyle) => void;
  volume: number;
  onVolumeChange: (volume: number) => void;
  rendering: boolean;
  error: string | null;
  audibleParts: BackingPart[];
  /** True when the piece brought its own accompaniment, so style has no effect. */
  imported: boolean;
  hasSolo: boolean;
}

/**
 * The listen control.
 *
 * Four modes rather than a set of checkboxes, because they are the four things
 * a player actually wants at different stages: silence when testing yourself,
 * the cello line when learning what a passage should sound like, the backing
 * when playing the solo over it, and everything when you want to hear how the
 * two fit together.
 */
export function ListenControl({
  mode, onModeChange, style, onStyleChange, volume, onVolumeChange,
  rendering, error, audibleParts, imported, hasSolo,
}: ListenControlProps) {
  const theme = useTheme();
  const { chrome } = theme;

  return (
    <Stack gap={12}>
      <Row>
        <Label size={11}>LISTEN</Label>
        <Grow />
        {rendering ? <Label size={10} color={chrome.accent}>PREPARING…</Label> : null}
      </Row>

      <Segmented segments={LISTEN_SEGMENTS} value={mode} onChange={onModeChange} grow />
      <Body size={12} color={chrome.dim}>{LISTEN_BLURB[mode]}</Body>

      {mode === 'solo' && !hasSolo ? (
        <Body size={12} color={chrome.accent}>
          This piece has no written cello line to play back.
        </Body>
      ) : null}

      {mode === 'off' ? null : (
        <>
          <Rule />
          <Row gap={10}>
            <Body size={14} style={{ flex: 1 }}>Level</Body>
            <Stepper
              label="backing level"
              value={Math.round(volume * 100)}
              display={`${Math.round(volume * 100)}%`}
              canDecrement={volume > 0.1}
              canIncrement={volume < 1}
              onDecrement={() => onVolumeChange(Math.max(0.1, Math.round((volume - 0.1) * 10) / 10))}
              onIncrement={() => onVolumeChange(Math.min(1, Math.round((volume + 0.1) * 10) / 10))}
            />
          </Row>

          {imported ? (
            <>
              <Rule />
              <Label size={10}>PARTS FROM THE IMPORTED FILE</Label>
              {audibleParts.map((part) => (
                <Row key={part.id} gap={8}>
                  <View
                    style={{
                      width: theme.s(5),
                      height: theme.s(14),
                      backgroundColor: part.role === 'solo' ? chrome.accent : chrome.line,
                    }}
                  />
                  <Body size={13} style={{ flex: 1 }}>{part.name}</Body>
                  <Label size={9}>{part.instrument.toUpperCase()}</Label>
                </Row>
              ))}
            </>
          ) : (
            <>
              <Rule />
              <Label size={11}>ACCOMPANIMENT</Label>
              <Segmented segments={STYLE_SEGMENTS} value={style} onChange={onStyleChange} grow compact />
              <Body size={12} color={chrome.dim}>{ACCOMPANIMENT_BLURB[style]}</Body>
            </>
          )}
        </>
      )}

      {error === null ? null : (
        <Body size={12} color={chrome.accent}>{error}</Body>
      )}
    </Stack>
  );
}

/** Compact readout for the play screen's status strip. */
export function ListenChip({
  mode, rendering,
}: { mode: ListenMode; rendering: boolean }) {
  const theme = useTheme();
  return (
    <Row gap={5}>
      <View
        style={{
          width: theme.s(6),
          height: theme.s(6),
          backgroundColor: mode === 'off' ? theme.chrome.lineSoft : theme.chrome.accent,
        }}
      />
      <Label size={10}>
        {rendering ? 'BACKING PREPARING' : `LISTEN ${LISTEN_LABEL[mode].toUpperCase()}`}
      </Label>
    </Row>
  );
}

/** Shows how long the rendered loop is, so a slow tempo is visible as a number. */
export function LoopLengthLabel({ ms }: { ms: number }) {
  if (ms <= 0) return null;
  const seconds = ms / 1000;
  return <Num size={11}>{`${seconds.toFixed(1)}s LOOP`}</Num>;
}
