import { computed, ref, watch } from 'vue';
import {
  DefaultMagicKeysAliasMap,
  onKeyStroke,
  useMagicKeys,
} from '@vueuse/core';

import { getEntries, wrapInArray } from '../utils';
import { ACTION_TO_KEY } from '../config';
import type { Action, Binding } from '../constants';
import { ACTION_TO_FUNC } from './actions';

export const actionToKey = ref<Record<Action, Binding>>(ACTION_TO_KEY);

/**
 * The bindings an action answers to. A binding may be written as a list when a
 * key reaches the action under more than one name, as the main delete key does
 * on macOS, where it reports Backspace.
 */
export const bindingsOf = (binding: Binding) => wrapInArray(binding);

/** How a binding reads in the UI, naming every key that reaches the action. */
export const readableBinding = (binding: Binding) =>
  bindingsOf(binding).join(' or ');

/**
 * Splits a binding into its keys. vueuse resolves any of + _ - as a chord
 * separator, so a binding that is itself one of those characters is a lone key.
 */
export const splitChord = (binding: string) =>
  binding.length === 1 ? [binding] : binding.split(/[+_-]/);

/**
 * True when a binding can ever fire. A chord separator in key position, as in
 * 'ctrl+-', splits into an empty key that no keystroke produces.
 */
export const isDispatchable = (binding: string) =>
  splitChord(binding).every((part) => part.length > 0);

/**
 * Tracks whether an action's key is currently held. Hold actions are read as
 * state by the views rather than dispatched, so they answer to any of their
 * bindings being down.
 */
export const useActionHeld = (action: Action) => {
  const keys = useMagicKeys();
  return computed(() =>
    bindingsOf(actionToKey.value[action]).some((binding) => keys[binding].value)
  );
};

/**
 * Resolves the aliases vueuse accepts in a binding, so a shortcut bound to
 * 'down' is recognized as the arrow key it fires on.
 */
const resolveAlias = (key: string) => DefaultMagicKeysAliasMap[key] ?? key;

// KeyboardEvent reports the space bar as a literal space; vueuse's alias map
// covers the rest of the shorthands a binding may use.
const resolveEventKey = (key: string) =>
  key === 'space' ? ' ' : resolveAlias(key);

/**
 * A binding split into the modifiers it requires and the key that completes it.
 * Modifiers are normalized to the names KeyboardEvent reports. The final key
 * keeps its case, which is what separates a 'g' binding from a shifted 'G'.
 */
const parseBinding = (binding: string) => {
  const chord = splitChord(binding);
  const finalKey = chord[chord.length - 1];
  const aliased = resolveEventKey(finalKey.toLowerCase());

  return {
    modifiers: new Set(
      chord.slice(0, -1).map((key) => resolveAlias(key.toLowerCase()))
    ),
    // an alias only ever names a non-printable key, so a key that resolves to
    // itself is the one whose case still matters
    key: aliased === finalKey.toLowerCase() ? finalKey : aliased,
  };
};

const modifiersOf = (event: KeyboardEvent) =>
  new Set(
    [
      event.ctrlKey && 'control',
      event.shiftKey && 'shift',
      event.altKey && 'alt',
      event.metaKey && 'meta',
    ].filter((modifier): modifier is string => !!modifier)
  );

const sameKeys = (a: Set<string>, b: Set<string>) =>
  a.size === b.size && [...a].every((key) => b.has(key));

/**
 * True when a keystroke completes this binding. Shift is the subtle case: it
 * both produces a different character and changes a letter's case, so the two
 * branches below judge it differently.
 */
const matchesBinding = (
  { modifiers, key }: ReturnType<typeof parseBinding>,
  event: KeyboardEvent
) => {
  const printable = key.length === 1;
  const needsShift = modifiers.has('shift');
  const pressed = modifiersOf(event);

  // Shift is already baked into a printable character, since Shift+/ arrives
  // as '?', so a binding that does not name shift must not be judged on it.
  if (printable && !needsShift) {
    pressed.delete('shift');
    return sameKeys(modifiers, pressed) && key === event.key;
  }

  // Shift is also what changes a letter's case, so a binding that names it
  // matches regardless of the case the character arrives in.
  return (
    sameKeys(modifiers, pressed) &&
    key.toLowerCase() === event.key.toLowerCase()
  );
};

// Anything a control handles in script reports itself through preventDefault,
// so the arbitration below only has to cover what the browser does natively and
// no handler announces: typing into a field, Space or Enter activating a
// focused control, and the arrow keys stepping through a group of values.

// input carries both kinds: everything not listed here takes typed characters.
const NON_TEXT_INPUT_TYPES = new Set(
  'button checkbox color file image radio range reset submit'.split(' ')
);
const TEXT_ENTRY_SELECTOR = 'input, textarea, [role="textbox"]';

const ARROW_KEYS = ['up', 'down', 'left', 'right'].map(
  (direction) => `arrow${direction}`
);

// The keys a control acts on natively, paired with the controls that claim them.
const NATIVE_KEY_CLAIMS = [
  { keys: ['enter', ' '], selector: 'input, select, button, [role="button"]' },
  {
    keys: ARROW_KEYS,
    selector: 'input[type="radio"], input[type="range"], select',
  },
].map(({ keys, selector }) => ({ keys: new Set(keys), selector }));

const isTextEntry = (element: HTMLElement) => {
  if (element.isContentEditable) return true;

  const control = element.closest(TEXT_ENTRY_SELECTOR);
  if (!control) return false;
  return !(
    control instanceof HTMLInputElement &&
    NON_TEXT_INPUT_TYPES.has(control.type)
  );
};

/**
 * True when the focused control would act on this key itself, so the shortcut
 * must stand aside. Takes the key a keystroke reports, not a binding.
 */
const keyClaimedByFocus = (key: string, activeElement: Element | null) => {
  if (!(activeElement instanceof HTMLElement)) {
    return false;
  }
  if (isTextEntry(activeElement)) {
    return true;
  }

  const pressed = key.toLowerCase();
  return NATIVE_KEY_CLAIMS.some(
    ({ keys, selector }) =>
      keys.has(pressed) && activeElement.closest(selector) !== null
  );
};

/**
 * Whether a binding must stand aside for the focused control. A chord is judged
 * by its final key, so ctrl+. yields to a text field but runs over a checkbox.
 */
export const shouldIgnoreKeyboardShortcuts = (
  binding: string,
  activeElement: Element | null = document.activeElement
) => keyClaimedByFocus(parseBinding(binding).key, activeElement);

const parseBindings = (actionMap: Record<Action, Binding>) =>
  getEntries(actionMap).flatMap(([action, configured]) =>
    bindingsOf(configured).map((binding) => ({
      action,
      ...parseBinding(binding),
    }))
  );

/**
 * Runs the action a keystroke is bound to. Takes the action map so a caller can
 * watch which action a key chose without standing in for the real ones.
 */
export function useKeyboardShortcuts(
  actions: Record<Action, () => void> = ACTION_TO_FUNC
) {
  let bindings = parseBindings(actionToKey.value);

  watch(
    actionToKey,
    (actionMap) => {
      bindings = parseBindings(actionMap);
    },
    { deep: true }
  );

  onKeyStroke(
    (event) => {
      // the focused control handled this key itself
      if (event.defaultPrevented) return;

      const hit = bindings.find((parsed) => matchesBinding(parsed, event));
      if (!hit) return;

      // arbitrate against the element the key was delivered to, not against
      // wherever focus has moved by the time this runs
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (keyClaimedByFocus(hit.key, target)) return;

      event.preventDefault();
      actions[hit.action]();
    },
    // a held key repeats; the shortcut already ran on the first press
    { dedupe: true }
  );
}
