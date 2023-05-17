import { expect } from 'chai';
import { DataSource, serializeDataSource } from '@/src/io/import/dataSource';

describe('serializeDataSource', () => {
  it('should remove FileSources', () => {
    const input: DataSource = {
      fileSrc: {
        file: new File([], '1.dcm'),
        fileType: 'application/dicom',
      },
    };
    const output = serializeDataSource(input);

    expect(output).to.deep.equal({});
  });

  it('should preserve archive status', () => {
    const input: DataSource = {
      fileSrc: {
        file: new File([], '1.dcm'),
        fileType: 'application/dicom',
      },
      archiveSrc: {
        path: 'a/b/c',
      },
      parent: {
        fileSrc: {
          file: new File([], 'archive.zip'),
          fileType: 'application/zip',
        },
      },
    };
    const output = serializeDataSource(input);

    expect(output).to.deep.equal({
      archiveSrc: {
        path: 'a/b/c',
      },
      parent: {},
    });
  });

  it('should preserve UriSource', () => {
    const input: DataSource = {
      uriSrc: {
        uri: 'https://example.com/image.jpg',
        name: 'image.jpg',
      },
      parent: {
        uriSrc: {
          uri: 's3://example/bucket',
          name: '',
        },
      },
    };
    const output = serializeDataSource(input);

    expect(output).to.deep.equal(input);
  });

  it('should serialize remote archive members', () => {
    const input: DataSource = {
      fileSrc: {
        file: new File([], '1.dcm'),
        fileType: 'application/dicom',
      },
      archiveSrc: {
        path: 'a/b/c',
      },
      parent: {
        fileSrc: {
          file: new File([], 'archive.zip'),
          fileType: 'application/zip',
        },
        parent: {
          uriSrc: {
            uri: 'https://example.com/archive.zip',
            name: 'archive.zip',
          },
        },
      },
    };
    const output = serializeDataSource(input);

    expect(output).to.deep.equal({
      archiveSrc: {
        path: 'a/b/c',
      },
      parent: {
        // empty parent b/c archive FileSource cannot be serialized
        parent: {
          uriSrc: {
            uri: 'https://example.com/archive.zip',
            name: 'archive.zip',
          },
        },
      },
    });
  });
});
