import { describe, expect, it } from 'vitest';
import { configIo, RENAMED_IO_KEYS } from '@/src/io/import/configIo';

describe.each(RENAMED_IO_KEYS)(
  'configuration alias %s -> %s',
  (legacy, key) => {
    it.each(['seg', ''])(
      'normalizes either spelling of %j to one runtime field',
      (value) => {
        const expected = {
          layerExtension: '',
          segmentationExtension: '',
          [key]: value,
        };
        for (const input of [
          { [legacy]: value },
          { [key]: value },
          { [legacy]: value, [key]: value },
        ]) {
          const parsed = configIo.parse(input);
          expect(parsed).toEqual(expected);
          expect(parsed).not.toHaveProperty(legacy);
        }
      }
    );

    it.each([
      ['seg', 'mask'],
      ['', 'seg'],
      ['seg', ''],
    ])('rejects conflicting aliases %j and %j', (oldValue, newValue) => {
      expect(() =>
        configIo.parse({ [legacy]: oldValue, [key]: newValue })
      ).toThrow(`io.${legacy} conflicts with io.${key}`);
    });

    it.each([null, 1])(
      'rejects non-string values %j in either spelling',
      (value) => {
        expect(configIo.safeParse({ [legacy]: value }).success).toBe(false);
        expect(configIo.safeParse({ [key]: value }).success).toBe(false);
      }
    );
  }
);

it('defaults only the extension when both aliases are omitted', () => {
  expect(configIo.parse({})).toEqual({
    layerExtension: '',
    segmentationExtension: '',
  });
});
