import { useThemePreference, useVisionPreferences } from '@state';

import { Disclosure, Label, Segmented, Toggle, type Segment } from '../ui';
import { BOARD_VIEWS, CHROME_SEGMENTS, HIGHWAY_AXES, SCORE_COLORS, TAB_AXES } from './setupOptions';

function LabelledSegmented<T extends string>({ label, segments, value, onChange }: {
  label: string; segments: readonly Segment<T>[]; value: T; onChange: (next: T) => void;
}) {
  return (
    <>
      <Label size={11}>{label}</Label>
      <Segmented accessibilityLabel={label} segments={segments} value={value} onChange={onChange} grow />
    </>
  );
}

/** How the music is drawn: per-vision orientation, fingerboard, overlays and theme. */
export function DisplayPreferences() {
  const settings = useVisionPreferences();
  const { update } = settings;
  const { chrome, setChrome } = useThemePreference();
  const summary = `${settings.showFingerings ? 'Fingerings on' : 'Fingerings hidden'} · ${chrome} theme`;
  return (
    <Disclosure title="Display preferences" summary={summary}>
      {settings.vision === 'highway' ? (
        <LabelledSegmented label="Highway direction" segments={HIGHWAY_AXES} value={settings.highwayAxis}
          onChange={(highwayAxis) => update({ highwayAxis })} />
      ) : null}
      {settings.vision === 'score' ? (
        <LabelledSegmented label="Score colours" segments={SCORE_COLORS} value={settings.scoreColor}
          onChange={(scoreColor) => update({ scoreColor })} />
      ) : null}
      {settings.vision === 'tab' ? (
        <LabelledSegmented label="Tab direction" segments={TAB_AXES} value={settings.tabAxis}
          onChange={(tabAxis) => update({ tabAxis })} />
      ) : null}
      <LabelledSegmented label="Fingerboard orientation" segments={BOARD_VIEWS} value={settings.boardView}
        onChange={(boardView) => update({ boardView })} />
      <Toggle label="Show fingerings" hint="Hide the numbers when you want to test yourself."
        value={settings.showFingerings} onChange={(showFingerings) => update({ showFingerings })} />
      <Toggle label="Show my tapes" hint="Match each note to your fingerboard tape colours."
        value={settings.showTapes} onChange={(showTapes) => update({ showTapes })} />
      <Toggle label="Show the same note elsewhere"
        hint="Ring the other places the note being played could be taken, in its tape colour where there is one."
        value={settings.showAlternatePlacements} onChange={(showAlternatePlacements) => update({ showAlternatePlacements })} />
      <Toggle label="Show all position guides" hint="Include every fingerboard landmark and bracket."
        value={settings.cueDensity === 'full'} onChange={(full) => update({ cueDensity: full ? 'full' : 'essentials' })} />
      <Toggle label="Hide the switchers while playing"
        hint="The view and sound rows leave the screen once the music starts, and come back when you pause."
        value={settings.hideControlsWhilePlaying} onChange={(hideControlsWhilePlaying) => update({ hideControlsWhilePlaying })} />
      <LabelledSegmented label="App theme" segments={CHROME_SEGMENTS} value={chrome}
        onChange={setChrome} />
    </Disclosure>
  );
}
