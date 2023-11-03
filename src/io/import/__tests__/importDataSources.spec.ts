import { describe, it } from 'vitest';
import { expect } from 'chai';
import { DataSource } from '../dataSource';
import { importDataSources } from '../importDataSources';

describe('importDataSources', () => {
  it('should return error if illegal URI', async () => {
    const input: DataSource = {
      uriSrc: {
        uri: '// asdf asdf',
        name: 'image.jpg',
      },
    };
    const output = await importDataSources([input]);

    const firstResult = output[0];
    expect(firstResult.ok).to.equals(false);
    if (!firstResult.ok) {
      expect(firstResult.errors.length).to.greaterThan(0);
    }
  });
});
