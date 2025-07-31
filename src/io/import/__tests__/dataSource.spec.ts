import { describe, it, expect } from 'vitest';
import {
  getDataSourceName,
  isRemoteDataSource,
} from '@/src/io/import/dataSource';
import { Chunk } from '@/src/core/streaming/chunk';

describe('isRemoteDatasource', () => {
  it('should work', () => {
    expect(isRemoteDataSource(undefined)).to.be.false;

    expect(
      isRemoteDataSource({
        type: 'file',
        file: new File([], 'name'),
        fileType: 'type',
      })
    ).to.be.false;

    expect(
      isRemoteDataSource({
        type: 'file',
        file: new File([], 'name'),
        fileType: 'type',
        parent: {
          type: 'uri',
          uri: 'http://',
          name: 'name',
        },
      })
    ).to.be.true;
  });
});

describe('getDataSourceName', () => {
  it('should work', () => {
    expect(
      getDataSourceName({
        type: 'file',
        file: new File([], 'name'),
        fileType: 'ft',
      })
    ).to.equal('name');

    expect(
      getDataSourceName({
        type: 'uri',
        uri: 'http://',
        name: 'name',
      })
    ).to.equal('name');

    expect(
      getDataSourceName({
        type: 'collection',
        sources: [
          {
            type: 'file',
            file: new File([], 'name'),
            fileType: 'ft',
          },
        ],
      })
    ).to.equal('name');

    expect(
      getDataSourceName({
        type: 'chunk',
        chunk: {} as Chunk,
        mime: 'mime',
      })
    ).to.equal(null);

    expect(
      getDataSourceName({
        type: 'chunk',
        chunk: {} as Chunk,
        mime: 'mime',
        parent: {
          type: 'file',
          file: new File([], 'name'),
          fileType: 'ft',
        },
      })
    ).to.equal('name');
  });
});
