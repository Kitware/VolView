import { describe, expect, it } from 'vitest';
import { shouldIgnoreKeyboardShortcuts } from '../useKeyboardShortcuts';

describe('shouldIgnoreKeyboardShortcuts', () => {
  it('ignores shortcuts while an input is focused', () => {
    const input = document.createElement('input');
    expect(shouldIgnoreKeyboardShortcuts(input)).toBe(true);
  });

  it('ignores shortcuts while a textarea is focused', () => {
    const textarea = document.createElement('textarea');
    expect(shouldIgnoreKeyboardShortcuts(textarea)).toBe(true);
  });

  it('ignores shortcuts while a contenteditable element is focused', () => {
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    expect(shouldIgnoreKeyboardShortcuts(editable)).toBe(true);
  });

  it('does not ignore shortcuts for non-editable controls', () => {
    const button = document.createElement('button');
    expect(shouldIgnoreKeyboardShortcuts(button)).toBe(false);
  });
});
