import { PickedMidi } from './pickMidi';

/**
 * Web file picker.
 *
 * A hidden `<input type="file">` clicked programmatically is still the only
 * way to open a file dialog from a browser. The element is removed once the
 * dialog resolves; if the player cancels, the browser fires no event at all,
 * so the promise settles from the window regaining focus instead.
 */
export async function pickMidi(): Promise<PickedMidi | null> {
  if (typeof document === 'undefined') return null;

  return new Promise<PickedMidi | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mid,.midi,audio/midi,audio/x-midi';
    input.style.display = 'none';

    let settled = false;
    const finish = (result: PickedMidi | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(result);
    };

    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) { finish(null); return; }
      const buffer = await file.arrayBuffer();
      finish({ name: file.name, bytes: new Uint8Array(buffer) });
    });

    // Cancelling a file dialog is silent in every browser, so treat the window
    // coming back into focus without a change event as a cancellation.
    window.addEventListener('focus', () => {
      setTimeout(() => finish(null), 600);
    }, { once: true });

    document.body.appendChild(input);
    input.click();
  });
}
