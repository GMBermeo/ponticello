import { useMemo } from 'react';
import { View } from 'react-native';

import {
  Button, PressableRow, Stepper, Badge, Body, Kicker, Label, Row, Stack, Title,
} from '../ui';
import {
  ArrangementLevel, ARRANGEMENT_PROFILES, midiToPitchName, CelloPartOption, nearestWorkableOctave,
  TrackChoice,
} from '@domain';
import { ResolvedCelloLine } from '@state';
import { useTheme } from '@theme';

/**
 * Which part of the song you play, and where it sits.
 *
 * Two references shaped this, and both are practice tools rather than mixers.
 *
 * **Rocksmith** puts the choice on the song's own screen and names it by the
 * part you will play — Lead, Rhythm, Bass — never by track number, and a song
 * that has no bass arrangement simply does not offer one. So the rows here are
 * named "Vocals", "Bass", "Cello" from the file's own labels, the octave
 * control sits immediately under the chosen part because it is a precondition
 * of playing it at all (Rocksmith puts the required *tuning* in exactly that
 * spot), and a part that cannot be bowed is shown greyed with the reason on it
 * rather than hidden — hiding it only raises the question of where the drum
 * track went.
 *
 * **Tomplay** frames the same idea as "your part adapts to your level, while
 * the rest of the band plays their original parts", which is exactly the
 * contract: choosing here changes your line and nothing else, and the part you
 * take is muted in the backing so you are not playing along to yourself.
 * Tomplay also lets you check *before* you buy whether a score supports
 * transposition, and that is the principle the octave row follows — the
 * consequence is on screen before the step is taken, including the reason the
 * stepper stops where it does.
 *
 * The one thing amateur versions get wrong is offering an option that will not
 * work. Every octave here has been costed by `describeOctaveFit`, the stepper
 * walks only the ones that work, and the sentence underneath is the truth about
 * the result rather than a reassurance.
 */
export function TrackPicker({
  options, line, choice, onChange, level,
}: {
  /** From `useTrackOptions`: the arrangement first, then every source part. */
  options: readonly CelloPartOption[];
  line: ResolvedCelloLine;
  choice: TrackChoice;
  onChange: (next: TrackChoice) => void;
  level: ArrangementLevel;
}) {
  const theme = useTheme();
  const selected = options.find((option) => option.id === choice.partId) ?? null;

  // One row is the arrangement on its own: a song with no source parts to
  // offer gets no picker rather than a picker with nothing in it.
  if (options.length <= 1) return null;

  return (
    <Stack gap={10}>
      <Row gap={10}>
        <Label size={11} style={{ flex: 1 }}>Play as your cello line</Label>
        {line.celloPart ? <Kicker size={10}>Cello in the source</Kicker> : null}
      </Row>

      <View style={{
        borderWidth: theme.rule(1),
        borderColor: theme.chrome.line,
        borderRadius: theme.s(10),
        overflow: 'hidden',
      }}>
        {options.map((option, index) => (
          <PartRow
            key={option.id ?? 'arrangement'}
            option={option}
            first={index === 0}
            selected={option.id === choice.partId && !line.fellBackBecause}
            onPress={() => onChange({ partId: option.id, octaves: option.suggested })}
          />
        ))}
      </View>

      {line.fellBackBecause
        ? <Fallback reason={line.fellBackBecause} option={selected} wanted={choice.octaves}
          onChange={onChange} />
        : null}

      {selected && selected.octaves.length > 0 && !line.fellBackBecause
        ? <OctaveControl option={selected} choice={choice} onChange={onChange} level={level} />
        : null}
    </Stack>
  );
}

/**
 * One part.
 *
 * The title is what a player calls it and the line under it is what it is —
 * what it plays, how much of it there is, and the register it was written in,
 * which is the reading that tells you in advance whether this will need moving.
 * A part written for cello says so in the accent, because it is the one row
 * where the arranging decisions were already made by someone who knew what
 * instrument they were writing for.
 */
function PartRow({ option, selected, first, onPress }: {
  option: CelloPartOption;
  selected: boolean;
  first: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const disabled = option.unplayable !== null;

  return (
    <PressableRow
      accessibilityLabel={`${option.label}. ${option.unplayable ?? option.detail}`}
      selected={selected}
      disabled={disabled}
      onPress={disabled ? undefined : onPress}
      style={{
        borderTopWidth: first ? 0 : theme.rule(1),
        borderColor: theme.chrome.lineSoft,
        paddingHorizontal: theme.s(12),
        paddingVertical: theme.s(10),
        justifyContent: 'center',
      }}
    >
      <Row gap={10}>
        <Marker selected={selected} />
        <Stack gap={3} style={{ flex: 1, minWidth: 0 }}>
          <Row gap={8}>
            <Title size={15} numberOfLines={1} style={{ flexShrink: 1 }}>{option.label}</Title>
            {option.writtenForCello
              ? <Badge label="For cello" background={theme.chrome.accent} />
              : null}
          </Row>
          <Body size={12} color={theme.chrome.dim} numberOfLines={2}>
            {option.unplayable ?? option.detail}
          </Body>
        </Stack>
      </Row>
    </PressableRow>
  );
}

/** A filled ring, not a tick: this is a choice of one from many. */
function Marker({ selected }: { selected: boolean }) {
  const theme = useTheme();
  return (
    <View style={{
      width: theme.s(16),
      height: theme.s(16),
      borderRadius: theme.s(8),
      borderWidth: theme.rule(selected ? 2 : 1),
      borderColor: selected ? theme.chrome.accent : theme.chrome.line,
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      {selected ? <View style={{
        width: theme.s(8), height: theme.s(8), borderRadius: theme.s(4),
        backgroundColor: theme.chrome.accent,
      }} /> : null}
    </View>
  );
}

/** "Written", "1 down", "2 octaves up" — the octave in words, not in signs. */
function octaveWord(octaves: number, long = false): string {
  if (octaves === 0) return long ? 'written pitch' : 'Written';
  const count = Math.abs(octaves);
  const direction = octaves < 0 ? 'down' : 'up';
  if (!long) return `${count} ${direction}`;
  return `${count} octave${count === 1 ? '' : 's'} ${direction}`;
}

/**
 * The octave, and what it costs.
 *
 * A stepper rather than a slider or a set of segments, for the same reason
 * tempo and the loop bars are steppers on this screen: it is a small integer
 * you nudge while reading the consequence, and the consequence is the sentence
 * underneath. The stepper walks only octaves that work — so there is no way to
 * select something the fingering model would refuse — and when it stops, the
 * line under it says what the step it will not take would have done. A control
 * that explains its own limit is worth more than one that simply greys out.
 */
function OctaveControl({ option, choice, onChange, level }: {
  option: CelloPartOption;
  choice: TrackChoice;
  onChange: (next: TrackChoice) => void;
  level: ArrangementLevel;
}) {
  const theme = useTheme();

  const { fit, down, up, blocked } = useMemo(() => {
    const workable = option.octaves
      .filter((candidate) => candidate.verdict !== 'refused')
      .map((candidate) => candidate.octaves)
      .sort((a, b) => a - b);
    // Step to the next octave that works rather than to the next integer, so a
    // refused octave cannot be reached even if the workable set has a gap in it.
    const nextDown = [...workable].reverse().find((value) => value < choice.octaves);
    const nextUp = workable.find((value) => value > choice.octaves);
    const octaveAt = (offset: number) => option.octaves.find((candidate) => candidate.octaves === choice.octaves + offset);
    let beyond: CelloPartOption['octaves'][number] | undefined;
    if (nextDown === undefined) beyond = octaveAt(-1);
    else if (nextUp === undefined) beyond = octaveAt(1);
    return {
      fit: option.octaves.find((candidate) => candidate.octaves === choice.octaves) ?? null,
      down: nextDown,
      up: nextUp,
      blocked: beyond ?? null,
    };
  }, [option.octaves, choice.octaves]);

  const folds = fit?.verdict === 'folds';

  return (
    <Stack gap={8}>
      <Row gap={12}>
        <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
          <Title size={15}>Octave</Title>
          <Body size={12} color={theme.chrome.dim}>
            {option.label} {choice.octaves === 0 ? 'at written pitch' : octaveWord(choice.octaves, true)}
          </Body>
        </Stack>
        <Stepper
          label="octave"
          value={choice.octaves}
          display={octaveWord(choice.octaves)}
          canDecrement={down !== undefined}
          canIncrement={up !== undefined}
          onDecrement={() => { if (down !== undefined) onChange({ ...choice, octaves: down }); }}
          onIncrement={() => { if (up !== undefined) onChange({ ...choice, octaves: up }); }}
        />
      </Row>

      {fit ? (
        <Row gap={8} accessibilityLiveRegion="polite">
          {folds
            ? <Badge label={`${fit.reseated} moved`} background={theme.chrome.accent} />
            : null}
          <Body size={12} color={folds ? theme.chrome.accent : theme.chrome.dim} style={{ flex: 1 }}>
            {fit.summary}
          </Body>
        </Row>
      ) : null}

      {blocked ? (
        <Body size={11} color={theme.chrome.dim}>
          {`No further: ${octaveWord(blocked.octaves, true)} would be ${blocked.rangeLabel}, `
            + `where ${blocked.reason.charAt(0).toLowerCase()}${blocked.reason.slice(1)}`}
        </Body>
      ) : null}

      {/* Names this level's own ceiling rather than a constant: Advanced stops
          at B3, and printing "D4" there would be exactly the kind of confident
          wrong number this control exists to avoid. */}
      <Body size={11} color={theme.chrome.dim}>
        {`Still ${level} level: first position, nothing above `
          + `${midiToPitchName(ARRANGEMENT_PROFILES[level].range.high)}, open strings preferred.`}
      </Body>
    </Stack>
  );
}

/**
 * A stored choice that no longer works.
 *
 * The library gets rebuilt, a part changes, or the player drops from Expert to
 * Beginner and an octave that fitted no longer does. Falling back to the
 * arrangement is right; doing it quietly is not, so this says what happened and
 * offers the repair rather than making the player rediscover it.
 */
function Fallback({ reason, option, wanted, onChange }: {
  reason: string;
  option: CelloPartOption | null;
  /** The octave the player asked for, so the repair is the smallest change. */
  wanted: number;
  onChange: (next: TrackChoice) => void;
}) {
  const theme = useTheme();
  const repair: number | null = option ? nearestWorkableOctave(option.octaves, wanted) : null;

  return (
    <Stack gap={8} style={{
      backgroundColor: theme.chrome.accentWash,
      borderRadius: theme.s(8),
      padding: theme.s(12),
    }}>
      <Label size={10} color={theme.chrome.accent}>Showing the arrangement</Label>
      <Body size={13}>{reason}</Body>
      {option && repair !== null ? (
        <Button
          label={`Use ${option.label} ${repair === 0 ? 'at written pitch' : octaveWord(repair, true)}`}
          onPress={() => onChange({ partId: option.id, octaves: repair })}
        />
      ) : null}
    </Stack>
  );
}

/**
 * One line for the play screen's top bar and the practice sheet's summary.
 *
 * Short on purpose: the play screen is landscape and every control there is
 * fighting for width, so what the player needs mid-session is which part they
 * are on and whether it was moved.
 */
export function trackChoiceSummary(line: ResolvedCelloLine): string {
  if (line.fellBackBecause) return 'Ponticello arrangement';
  if (!line.partId) return 'Ponticello arrangement';
  return line.octaves === 0
    ? line.label
    : `${line.label}, ${octaveWord(line.octaves, true)}`;
}
