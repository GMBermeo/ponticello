import React from 'react';
import { View } from 'react-native';

import {
  CelloString, midiAt, midiToPitchName, STRING_NUMERAL, STRING_ORDER, Tape, TapeSet,
} from '@domain';
import { useTheme, alpha, TAPE_COLOR_LABEL } from '@theme';
import { Body, Label, Num, Row, Rule, Stack, Title } from '../ui';

/**
 * Still diagrams for the tutorial.
 *
 * Built separately from the live play components rather than freezing them: a
 * teaching diagram wants callouts, generous spacing and one idea at a time,
 * where the live view wants density and no explanation at all. They share the
 * palette and the geometry constants, so they cannot disagree about what a
 * thing looks like.
 */

// ─── Tape reference table ────────────────────────────────────────────────────

/**
 * What each tape gives you on each string.
 *
 * This is the table that makes two identical yellows unambiguous: the tape
 * narrows it to a semitone, and the string finishes the job.
 */
export function TapeTable({ set }: { set: TapeSet }) {
  const theme = useTheme();
  const { chrome } = theme;

  const cell = {
    flex: 1,
    paddingVertical: theme.s(9),
    paddingHorizontal: theme.s(8),
  } as const;

  return (
    <View style={{ borderWidth: theme.rule(1), borderColor: chrome.line }}>
      <Row style={{ backgroundColor: chrome.surface }}>
        <View style={{ ...cell, flex: 1.5 }}><Label size={10}>TAPE</Label></View>
        <View style={cell}><Label size={10}>FINGER</Label></View>
        {STRING_ORDER.map((string) => (
          <View key={string} style={cell}>
            <Label size={10} color={chrome.strings[string]}>
              {`${string} · ${STRING_NUMERAL[string]}`}
            </Label>
          </View>
        ))}
      </Row>
      <Rule />

      {set.tapes.map((tape, index) => (
        <View key={tape.id}>
          <Row>
            <View style={{ ...cell, flex: 1.5, flexDirection: 'row', alignItems: 'center', gap: theme.s(8) }}>
              <View
                style={{
                  width: theme.s(28),
                  height: theme.s(12),
                  backgroundColor: chrome.tapes[tape.color],
                }}
              />
              <Label size={10} color={chrome.ink}>{ordinalLabel(set, tape)}</Label>
            </View>
            <View style={cell}>
              <Num size={14}>{tape.finger}</Num>
              <Label size={9}>{tape.caption}</Label>
            </View>
            {STRING_ORDER.map((string) => {
              const spelling = spell(midiAt(string, tape.semitones));
              return (
                <View key={string} style={cell}>
                  <Num size={14} color={chrome.strings[string]}>{spelling.primary}</Num>
                  {spelling.alternate === null ? null : (
                    <Label size={9}>{spelling.alternate}</Label>
                  )}
                </View>
              );
            })}
          </Row>
          {index === set.tapes.length - 1 ? null : <Rule />}
        </View>
      ))}
    </View>
  );
}

/**
 * A note's name, with its enharmonic twin underneath when it has one.
 *
 * The tapes land on black keys as often as white ones, and which spelling a
 * cellist reads depends entirely on the key: the third tape on the C string is
 * D sharp in B major and E flat in E flat major. Printing both keeps the table
 * usable whichever piece is open, and uses the proper glyphs rather than the
 * typewriter `#` and `b`.
 */
function spell(midi: number): { primary: string; alternate: string | null } {
  const sharp = midiToPitchName(midi, false).replace('#', '\u266f');
  const flat = midiToPitchName(midi, true).replace('b', '\u266d');
  return { primary: sharp, alternate: sharp === flat ? null : flat };
}

const ORDINALS: readonly string[] = ['First', 'Second', 'Third', 'Fourth'];

/** "Blue", or "First yellow" when the set has more than one of that colour. */
function ordinalLabel(set: TapeSet, tape: Tape): string {
  const sameColor = set.tapes.filter((t) => t.color === tape.color);
  const name = TAPE_COLOR_LABEL[tape.color];
  if (sameColor.length < 2) return name;
  const nth = sameColor.findIndex((t) => t.id === tape.id);
  const ordinal = ORDINALS[nth] ?? `${nth + 1}th`;
  return `${ordinal} ${name.toLowerCase()}`;
}

// ─── Finger key ──────────────────────────────────────────────────────────────

const FINGERS: { glyph: string; name: string; note: string }[] = [
  { glyph: '0', name: 'Open string', note: 'No left hand at all. Let it ring.' },
  { glyph: '1', name: 'Index', note: 'The finger that anchors the hand.' },
  { glyph: '2', name: 'Middle', note: 'One semitone above the first.' },
  { glyph: '3', name: 'Ring', note: 'One semitone above the second.' },
  { glyph: '4', name: 'Little finger', note: 'The far edge of the frame.' },
  { glyph: 'T', name: 'Thumb', note: 'Only up in thumb position, laid flat across two strings.' },
];

export function FingerKey() {
  const theme = useTheme();
  const { chrome } = theme;

  return (
    <View>
      {FINGERS.map((finger, index) => (
        <View key={finger.glyph}>
          <Row gap={14} padY={10}>
            <View
              style={{
                width: theme.s(34),
                height: theme.s(30),
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: theme.rule(2),
                borderColor: chrome.line,
              }}
            >
              <Num size={15}>{finger.glyph}</Num>
            </View>
            <View style={{ flex: 1 }}>
              <Title size={15}>{finger.name}</Title>
              <Body size={13} color={chrome.dim}>{finger.note}</Body>
            </View>
          </Row>
          {index === FINGERS.length - 1 ? null : <Rule />}
        </View>
      ))}
    </View>
  );
}

// ─── Still of the tab stave ──────────────────────────────────────────────────

interface StillNote {
  string: CelloString;
  finger: string;
  tape?: string;
  active?: boolean;
}

const TAB_STILL: StillNote[] = [
  { string: 'G', finger: '0' },
  { string: 'D', finger: '0' },
  { string: 'A', finger: '1', tape: 'blue', active: true },
  { string: 'A', finger: '0' },
  { string: 'A', finger: '2', tape: 'yellow' },
  { string: 'D', finger: '3', tape: 'yellow' },
];

/** Annotated still of the tab stave, matching the live vision's language. */
export function TabStill() {
  const theme = useTheme();
  const { chrome } = theme;

  const rowHeight = theme.s(42);
  const staveTop = theme.s(30);
  const step = theme.s(64);
  const left = theme.s(56);
  const playheadX = left + step * 2;
  const height = staveTop + rowHeight * 3 + theme.s(46);

  return (
    <View style={{ height, backgroundColor: chrome.surface }}>
      {STRING_ORDER.map((string, index) => {
        const y = staveTop + (3 - index) * rowHeight;
        return (
          <View key={string}>
            <View
              style={{
                position: 'absolute',
                left: theme.s(30),
                right: theme.s(10),
                top: y,
                height: theme.rule(2),
                backgroundColor: chrome.strings[string],
              }}
            />
            <View style={{ position: 'absolute', left: theme.s(10), top: y - theme.s(9) }}>
              <Num size={14} color={chrome.strings[string]}>{string}</Num>
            </View>
          </View>
        );
      })}

      {/* Position bracket. */}
      <View
        style={{
          position: 'absolute',
          left: left - theme.s(22),
          width: step * 5 + theme.s(44),
          top: theme.s(6),
          height: theme.s(10),
          borderLeftWidth: theme.rule(2),
          borderRightWidth: theme.rule(2),
          borderTopWidth: theme.rule(2),
          borderColor: chrome.line,
        }}
      />
      <View style={{ position: 'absolute', left: left - theme.s(18), top: theme.s(-4), backgroundColor: chrome.surface, paddingHorizontal: theme.s(4) }}>
        <Label size={10}>1ST POSITION</Label>
      </View>

      {TAB_STILL.map((note, index) => {
        const y = staveTop + (3 - STRING_ORDER.indexOf(note.string)) * rowHeight;
        const x = left + index * step;
        const color = chrome.strings[note.string];
        return (
          <View
            key={`${note.string}-${index}`}
            style={{
              position: 'absolute',
              left: x - theme.s(18),
              top: y - theme.s(16),
              width: theme.s(36),
              height: theme.s(32),
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: note.active ? color : chrome.bg,
              borderWidth: theme.rule(2),
              borderColor: color,
            }}
          >
            {note.tape === undefined ? null : (
              <View
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: theme.s(5),
                  backgroundColor: chrome.tapes[note.tape as keyof typeof chrome.tapes],
                }}
              />
            )}
            <Num size={14} color={note.active ? chrome.bg : color}>{note.finger}</Num>
          </View>
        );
      })}

      <View
        style={{
          position: 'absolute',
          left: playheadX,
          top: 0,
          bottom: theme.s(24),
          width: theme.rule(2),
          backgroundColor: chrome.accent,
        }}
      />
      <View style={{ position: 'absolute', left: playheadX + theme.s(8), bottom: theme.s(4) }}>
        <Label size={10} color={chrome.accent}>NOW — PLAY THIS ONE</Label>
      </View>
    </View>
  );
}

// ─── Still of the highway ────────────────────────────────────────────────────

const HIGHWAY_STILL: { lane: CelloString; finger: string; tape?: string; row: number }[] = [
  { lane: 'G', finger: '0', row: 0 },
  { lane: 'A', finger: '1', tape: 'blue', row: 1 },
  { lane: 'D', finger: '3', tape: 'yellow', row: 2 },
  { lane: 'A', finger: '0', row: 3 },
];

export function HighwayStill() {
  const theme = useTheme();
  const { chrome } = theme;

  const laneStep = theme.s(74);
  const laneWidth = theme.s(64);
  const rowHeight = theme.s(44);
  const top = theme.s(12);
  const height = top + rowHeight * 4 + theme.s(46);
  const hitY = top + rowHeight * 4;

  return (
    <View style={{ height, backgroundColor: chrome.surface }}>
      {STRING_ORDER.map((string, index) => (
        <View
          key={string}
          style={{
            position: 'absolute',
            top,
            height: rowHeight * 4,
            left: theme.s(14) + index * laneStep,
            width: laneWidth,
            backgroundColor: alpha(chrome.strings[string], 0.12),
          }}
        />
      ))}

      {HIGHWAY_STILL.map((note, index) => {
        const laneIndex = STRING_ORDER.indexOf(note.lane);
        const color = chrome.strings[note.lane];
        return (
          <View
            key={index}
            style={{
              position: 'absolute',
              left: theme.s(14) + laneIndex * laneStep,
              top: top + note.row * rowHeight + theme.s(6),
              width: laneWidth,
              height: rowHeight - theme.s(12),
              backgroundColor: alpha(color, 0.3),
              borderWidth: theme.rule(2),
              borderColor: color,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {note.tape === undefined ? null : (
              <View
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: theme.s(7),
                  backgroundColor: chrome.tapes[note.tape as keyof typeof chrome.tapes],
                }}
              />
            )}
            <Num size={14} color={chrome.ink}>{note.finger}</Num>
          </View>
        );
      })}

      <View
        style={{
          position: 'absolute',
          left: theme.s(14),
          width: laneStep * 3 + laneWidth,
          top: hitY,
          height: theme.rule(3),
          backgroundColor: chrome.accent,
        }}
      />
      <View style={{ position: 'absolute', left: theme.s(14), top: hitY + theme.s(8) }}>
        <Label size={10} color={chrome.accent}>HIT LINE — BOW WHEN A BLOCK TOUCHES IT</Label>
      </View>

      {STRING_ORDER.map((string, index) => (
        <View
          key={string}
          style={{
            position: 'absolute',
            top: hitY + theme.s(24),
            left: theme.s(14) + index * laneStep + laneWidth / 2 - theme.s(6),
          }}
        >
          <Num size={13} color={chrome.strings[string]}>{string}</Num>
        </View>
      ))}
    </View>
  );
}

// ─── Cents rail still ────────────────────────────────────────────────────────

export function CentsStill() {
  const theme = useTheme();
  const { chrome } = theme;
  const height = theme.s(150);
  const band = theme.s(38);

  return (
    <Row gap={18} style={{ alignItems: 'stretch' }}>
      <View style={{ width: theme.s(96), height, borderLeftWidth: theme.rule(1), borderColor: chrome.line }}>
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: height / 2 - band / 2,
            height: band,
            backgroundColor: chrome.surface,
          }}
        />
        <View style={{ position: 'absolute', left: 0, right: 0, top: height / 2, height: theme.rule(1), backgroundColor: chrome.line }} />
        <View style={{ position: 'absolute', left: 0, right: 0, top: height / 2 - theme.s(14), height: theme.rule(3), backgroundColor: chrome.accent }} />
        <View style={{ position: 'absolute', left: theme.s(6), top: theme.s(2) }}><Label size={9}>+60¢</Label></View>
        <View style={{ position: 'absolute', left: theme.s(6), bottom: theme.s(2) }}><Label size={9}>−60¢</Label></View>
      </View>

      <Stack gap={8} style={{ flex: 1 }}>
        <Body size={14}>
          A cent is a hundredth of a semitone. The shaded box is ±15 cents — anything inside it
          counts as in tune, and the app will not nag you about it.
        </Body>
        <Body size={14} color={chrome.dim}>
          The bar above the centre line means sharp: the note is too high, so the finger is
          too far from the nut. Below the line means flat — slide back towards the scroll.
        </Body>
        <Row gap={8}>
          <View style={{ width: theme.s(24), height: theme.rule(3), backgroundColor: chrome.accent, alignSelf: 'center' }} />
          <Label size={10}>THIS ONE IS ABOUT 11 CENTS SHARP</Label>
        </Row>
      </Stack>
    </Row>
  );
}

// ─── Callout ─────────────────────────────────────────────────────────────────

export function Callout({ title, children }: { title: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={{
        paddingLeft: theme.s(4),
        paddingVertical: theme.s(4),
      }}
    >
      <Label size={10} color={theme.chrome.accent}>{title}</Label>
      <View style={{ marginTop: theme.s(5) }}>{children}</View>
    </View>
  );
}
