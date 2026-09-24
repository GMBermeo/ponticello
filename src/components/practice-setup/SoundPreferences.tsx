import type { BackingState } from '@audio';
import { useAudioPreferences } from '@state';

import { ListenControl } from '../play';
import { Button, Disclosure } from '../ui';
import { LISTEN_SUMMARY } from './setupOptions';

const MS_PER_SECOND = 1000;

export type SoundPreferencesProps = {
  listen: BackingState;
  fixedBacking: boolean;
  previewing: boolean;
  onTogglePreview: () => void;
};

/** Accompaniment mode, style and volume, plus a preview of the chosen loop. */
export function SoundPreferences({ listen, fixedBacking, previewing, onTogglePreview }: SoundPreferencesProps) {
  const { listenMode, accompaniment, backingVolume, update } = useAudioPreferences();
  const previewLength = `${(listen.loopDurationMs / MS_PER_SECOND).toFixed(1)}s`;
  return (
    <Disclosure title="Sound & listening" summary={LISTEN_SUMMARY[listenMode]}>
      <ListenControl mode={listenMode} onModeChange={(listenMode) => update({ listenMode })}
        style={accompaniment} onStyleChange={(accompaniment) => update({ accompaniment })}
        volume={backingVolume} onVolumeChange={(backingVolume) => update({ backingVolume })}
        rendering={listen.rendering} error={listen.error} audibleParts={listen.audibleParts}
        fixedBacking={fixedBacking} hasSolo={listen.hasSolo} />
      {listenMode === 'off' ? null : (
        <Button label={previewing ? 'Stop preview' : 'Preview this loop'}
          hint={listen.rendering ? 'Preparing…' : previewLength}
          onPress={onTogglePreview} disabled={!listen.ready && !previewing} />
      )}
    </Disclosure>
  );
}
