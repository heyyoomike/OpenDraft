import { describe, expect, it } from 'vitest';
import { pickTopLayer } from './modalAccessibility';

/** A stand-in for a dialog box: its name and the z-index it is painted at. */
interface Layer { name: string; z: number }
const level = (layer: Layer) => layer.z;
const top = (...layers: Layer[]) => pickTopLayer(layers, level)?.name;

describe('pickTopLayer', () => {
  it('is nothing when no dialog is open', () => {
    expect(top()).toBeUndefined();
  });

  it('is the dialog painted highest, even when it opened first', () => {
    // The recovery prompt opens at start-up at z-index 3500; the format
    // picker for a new screenplay opens after it at the default 3000. The
    // prompt is the one on screen, so it is the one that takes input —
    // treating the picker as active made the visible prompt ignore clicks.
    expect(top({ name: 'recovery', z: 3500 }, { name: 'format picker', z: 3000 })).toBe('recovery');
  });

  it('is the one opened last among dialogs painted at the same level', () => {
    expect(top({ name: 'first', z: 3000 }, { name: 'second', z: 3000 })).toBe('second');
  });

  it('keeps a nested scope above the dialog it opened from', () => {
    // A scope inside a dialog is painted at its parent's level, and
    // registerModal orders it after the parent.
    expect(top({ name: 'parent', z: 3000 }, { name: 'nested', z: 3000 })).toBe('nested');
  });

  it('lets a dialog opened later on a higher level take over', () => {
    expect(top({ name: 'dialog', z: 3000 }, { name: 'prompt', z: 3500 }, { name: 'below', z: 0 })).toBe('prompt');
  });
});
