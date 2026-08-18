import { describe, it, expect } from 'vitest';
import { config } from '@/src/io/import/configJson';

describe('config schema', () => {
  describe('shortcuts', () => {
    it('should accept partial shortcuts', () => {
      const result = config.safeParse({
        shortcuts: {
          polygon: 'Ctrl+p',
          rectangle: 'b',
        },
      });

      expect(result.success).to.be.true;
      expect(result.data?.shortcuts).to.deep.equal({
        polygon: 'Ctrl+p',
        rectangle: 'b',
      });
    });

    it('should reject invalid shortcut keys', () => {
      const result = config.safeParse({
        shortcuts: {
          invalidKey: 'Ctrl+x',
        },
      });

      expect(result.success).to.be.false;
    });

    it('should accept a list of keys for one action', () => {
      const result = config.safeParse({
        shortcuts: {
          deleteSelectedAnnotations: ['delete', 'backspace'],
        },
      });

      expect(result.success).to.be.true;
      expect(result.data?.shortcuts?.deleteSelectedAnnotations).to.deep.equal([
        'delete',
        'backspace',
      ]);
    });

    // + - and _ separate the keys of a chord, so a binding with one in key
    // position can never fire. It is dropped on apply, not rejected here,
    // so the rest of the config still loads.
    it.each(['ctrl+-', '-', 'shift+_'])(
      'should still parse a config carrying the unbindable %s',
      (binding) => {
        const result = config.safeParse({ shortcuts: { polygon: binding } });

        expect(result.success).to.be.true;
      }
    );

    it('should accept empty shortcuts', () => {
      const result = config.safeParse({
        shortcuts: {},
      });

      expect(result.success).to.be.true;
    });

    it('should accept config without shortcuts', () => {
      const result = config.safeParse({});

      expect(result.success).to.be.true;
    });
  });
});
