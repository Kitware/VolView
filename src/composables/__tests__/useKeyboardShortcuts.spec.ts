import { beforeEach, describe, expect, it } from 'vitest';
import { effectScope, nextTick } from 'vue';
import {
  actionToKey,
  shouldIgnoreKeyboardShortcuts,
  splitChord,
  useKeyboardShortcuts,
} from '../useKeyboardShortcuts';
import { ACTIONS, type Action } from '@/src/constants';
import { getEntries } from '@/src/utils';

// The dispatcher's job is choosing an action, so the test supplies a map that
// records the choice instead of the real actions, which would drag in the
// stores and views each one drives.
const firedActions: Action[] = [];
const recordAction = Object.fromEntries(
  getEntries(ACTIONS).map(([action]) => [
    action,
    () => {
      firedActions.push(action);
    },
  ])
) as Record<Action, () => void>;

const input = (type?: string) => {
  const element = document.createElement('input');
  if (type) element.type = type;
  return element;
};

const contentEditable = () => {
  const element = document.createElement('div');
  element.contentEditable = 'true';
  return element;
};

const withRole = (role: string) => {
  const element = document.createElement('div');
  element.setAttribute('role', role);
  return element;
};

const insideTextbox = () => {
  const child = document.createElement('span');
  withRole('textbox').appendChild(child);
  return child;
};

describe('shouldIgnoreKeyboardShortcuts', () => {
  describe('text entry keeps the keys it types with', () => {
    it.each(['m', 'delete', 'backspace', 'arrowdown', 'home', '?'])(
      'yields %s to a text input',
      (binding) => {
        expect(shouldIgnoreKeyboardShortcuts(binding, input('text'))).toBe(
          true
        );
      }
    );

    it('yields to a text input with no explicit type', () => {
      expect(shouldIgnoreKeyboardShortcuts('m', input())).toBe(true);
    });

    it('yields to a textarea', () => {
      expect(
        shouldIgnoreKeyboardShortcuts('m', document.createElement('textarea'))
      ).toBe(true);
    });

    it('yields to a contenteditable element', () => {
      expect(shouldIgnoreKeyboardShortcuts('m', contentEditable())).toBe(true);
    });

    it('yields to a role=textbox element', () => {
      expect(shouldIgnoreKeyboardShortcuts('m', withRole('textbox'))).toBe(
        true
      );
    });

    it('yields for an element nested inside a textbox control', () => {
      expect(shouldIgnoreKeyboardShortcuts('m', insideTextbox())).toBe(true);
    });

    it('yields enter to a textarea, which takes it as a newline', () => {
      expect(
        shouldIgnoreKeyboardShortcuts(
          'enter',
          document.createElement('textarea')
        )
      ).toBe(true);
    });

    it.each([
      ['down', 'arrowdown'],
      ['up', 'arrowup'],
      ['left', 'arrowleft'],
      ['right', 'arrowright'],
    ])('yields %s, the alias vueuse fires as %s', (binding) => {
      expect(shouldIgnoreKeyboardShortcuts(binding, input('text'))).toBe(true);
    });

    it('yields the arrow keys to a number input, which steps with them', () => {
      expect(shouldIgnoreKeyboardShortcuts('arrowup', input('number'))).toBe(
        true
      );
    });

    it('treats a hyphen chord as a shift combination, not a bare key', () => {
      expect(shouldIgnoreKeyboardShortcuts('shift-c', input('text'))).toBe(
        true
      );
    });
  });

  describe('modifier chords are judged by their final key', () => {
    it.each(['ctrl+.', 'ctrl+/', 'meta+k'])(
      'yields %s to a text input',
      (binding) => {
        expect(shouldIgnoreKeyboardShortcuts(binding, input('text'))).toBe(
          true
        );
      }
    );

    it.each(['ctrl+.', 'ctrl+/', 'meta+k'])(
      'runs %s while a checkbox holds focus',
      (binding) => {
        expect(shouldIgnoreKeyboardShortcuts(binding, input('checkbox'))).toBe(
          false
        );
      }
    );
  });

  describe('checkboxes and buttons only answer to space and enter', () => {
    it.each(['delete', 'm', 'arrowdown', '?'])(
      'runs %s while a checkbox holds focus',
      (binding) => {
        expect(shouldIgnoreKeyboardShortcuts(binding, input('checkbox'))).toBe(
          false
        );
      }
    );

    it.each(['space', 'enter'])('yields %s to a checkbox', (binding) => {
      expect(shouldIgnoreKeyboardShortcuts(binding, input('checkbox'))).toBe(
        true
      );
    });

    it('runs a shortcut while a button holds focus', () => {
      expect(
        shouldIgnoreKeyboardShortcuts(
          'delete',
          document.createElement('button')
        )
      ).toBe(false);
    });
  });

  describe('controls that step through values keep the arrow keys', () => {
    it('yields arrowdown to a radio input', () => {
      expect(shouldIgnoreKeyboardShortcuts('arrowdown', input('radio'))).toBe(
        true
      );
    });

    it('runs a letter shortcut over a radio input', () => {
      expect(shouldIgnoreKeyboardShortcuts('m', input('radio'))).toBe(false);
    });

    it('yields arrowup to a range input', () => {
      expect(shouldIgnoreKeyboardShortcuts('arrowup', input('range'))).toBe(
        true
      );
    });

    it('runs a letter shortcut over a range input', () => {
      expect(shouldIgnoreKeyboardShortcuts('m', input('range'))).toBe(false);
    });

    // v-slider claims the arrow keys by calling preventDefault, so the
    // dispatcher yields to it on the event rather than on the element; see
    // 'stands aside when the control already handled the key' below
    it('runs a letter shortcut over a slider thumb', () => {
      expect(shouldIgnoreKeyboardShortcuts('m', withRole('slider'))).toBe(
        false
      );
    });

    it('runs delete over a slider thumb', () => {
      expect(shouldIgnoreKeyboardShortcuts('delete', withRole('slider'))).toBe(
        false
      );
    });
  });

  it('runs shortcuts when nothing is focused', () => {
    expect(shouldIgnoreKeyboardShortcuts('m', null)).toBe(false);
  });
});

describe('splitChord', () => {
  it.each([
    ['ctrl+.', ['ctrl', '.']],
    ['shift-c', ['shift', 'c']],
    ['ctrl_alt+k', ['ctrl', 'alt', 'k']],
    ['delete', ['delete']],
  ])('splits %s on any separator vueuse accepts', (binding, keys) => {
    expect(splitChord(binding)).toEqual(keys);
  });

  it.each(['-', '+', '_'])(
    'reads a lone %s as a key, not a separator',
    (key) => {
      expect(splitChord(key)).toEqual([key]);
    }
  );

  it('keeps the case of the binding', () => {
    expect(splitChord('Shift')).toEqual(['Shift']);
  });
});

describe('the dispatcher', () => {
  // a real keystroke starts at the focused element, bubbles, and is cancelable
  const press = (
    init: KeyboardEventInit,
    target: EventTarget = document.body
  ) => {
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ...init,
    });
    target.dispatchEvent(event);
    return event;
  };

  const withShortcuts = async (typeKeys: () => void) => {
    const scope = effectScope();
    scope.run(() => useKeyboardShortcuts(recordAction));
    typeKeys();
    await nextTick();
    scope.stop();
  };

  const baseline = { ...actionToKey.value };

  beforeEach(() => {
    firedActions.length = 0;
    actionToKey.value = { ...baseline };
    document.body.innerHTML = '';
  });

  it('runs the action bound to a bare key', async () => {
    await withShortcuts(() => press({ key: 'm' }));
    expect(firedActions).toContain('ruler');
  });

  it('runs a modifier chord', async () => {
    await withShortcuts(() => press({ key: '.', ctrlKey: true }));
    expect(firedActions).toContain('deleteCurrentImage');
  });

  it('runs a chord whose character already carries the shift', async () => {
    await withShortcuts(() => press({ key: '?', shiftKey: true }));
    expect(firedActions).toContain('showKeyboardShortcuts');
  });

  it('answers every binding in a list', async () => {
    actionToKey.value = { ...baseline, polygon: ['g', 'F9'] };
    await withShortcuts(() => press({ key: 'F9' }));
    expect(firedActions).toContain('polygon');
  });

  // the main delete key reports Backspace on macOS
  it('deletes on backspace as well as delete', async () => {
    await withShortcuts(() => press({ key: 'Backspace' }));
    expect(firedActions).toContain('deleteSelectedAnnotations');
  });

  it('runs a shift chord bound with a lowercase key', async () => {
    actionToKey.value = { ...baseline, polygon: 'shift-g' };
    await withShortcuts(() => press({ key: 'G', shiftKey: true }));
    expect(firedActions).toContain('polygon');
  });

  it('leaves a bare-letter binding alone while shift is held', async () => {
    await withShortcuts(() => press({ key: 'G', shiftKey: true }));
    expect(firedActions).not.toContain('polygon');
  });

  it('leaves a chord alone when an extra modifier is held', async () => {
    await withShortcuts(() => press({ key: '.', ctrlKey: true, altKey: true }));
    expect(firedActions).not.toContain('deleteCurrentImage');
  });

  // the hold behaviors read their key as state in the views, so their action is
  // a no-op here; the dispatcher matching them changes nothing
  it('leaves a modifier-only binding to the views that read it', async () => {
    await withShortcuts(() => press({ key: 'Shift', shiftKey: true }));
    expect(firedActions).not.toContain('mergeNewPolygon');
  });

  it('stands aside when the control already handled the key', async () => {
    const thumb = withRole('slider');
    document.body.appendChild(thumb);
    thumb.addEventListener('keydown', (event) => event.preventDefault());

    await withShortcuts(() => press({ key: 'm' }, thumb));
    expect(firedActions).not.toContain('ruler');
  });

  it('suppresses the control default once a shortcut runs', async () => {
    let event: KeyboardEvent | undefined;
    await withShortcuts(() => {
      event = press({ key: 'm' });
    });
    expect(firedActions).toContain('ruler');
    expect(event!.defaultPrevented).toBe(true);
  });

  // Vuetify moves focus inside its own keydown handlers, so the element that
  // received the key is the one to arbitrate against
  it('arbitrates on the element the key reached, not on later focus', async () => {
    const field = input('text');
    const elsewhere = document.createElement('button');
    document.body.append(field, elsewhere);
    field.addEventListener('keydown', () => elsewhere.focus());

    await withShortcuts(() => press({ key: 'm' }, field));
    expect(firedActions).not.toContain('ruler');
  });
});
