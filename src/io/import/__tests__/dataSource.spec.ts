import { expect } from 'chai';
import {
  RemoteDatasetFile,
  ZipDatasetFile,
  isRemote,
} from '@/src/store/datasets-files';
import { convertDataSourceToDatasetFile } from '@/src/io/import/dataSource';
import * as path from '@/src/utils/path';

describe('convertDataSourceToDatasetFile', () => {
  it('should convert a basic file source to a DatasetFile', () => {
    const fileSrc = {
      file: new File([], 'myfile.dcm'),
      fileType: 'application/dicom',
    };

    const dataset = convertDataSourceToDatasetFile({ fileSrc });

    expect(dataset.file.name).to.equal(fileSrc.file.name);
    expect(dataset.file.type).to.equal(fileSrc.fileType);
  });

  it('should convert a remote file source to a DatasetFile', () => {
    const source = {
      fileSrc: {
        file: new File([], 'myfile.dcm'),
        fileType: 'application/dicom',
      },
      parent: {
        uriSrc: {
          uri: 'https://my-dataset-uri',
          name: 'myfile.dcm',
        },
      },
    };

    const dataset = convertDataSourceToDatasetFile(source) as RemoteDatasetFile;

    expect(isRemote(dataset)).to.be.true;
    expect(dataset.remoteFilename).to.equal(source.parent.uriSrc.name);
    expect(dataset.url).to.equal(source.parent.uriSrc.uri);
  });

  it('should convert a file derived from a remote archive to a DatasetFile', () => {
    const source = {
      fileSrc: {
        file: new File([], 'myfile.dcm'),
        fileType: 'application/dicom',
      },
      archiveSrc: {
        path: 'innerPath/',
      },
      parent: {
        uriSrc: {
          uri: 'https://my-dataset-uri',
          name: 'myfile.dcm',
        },
      },
    };

    const dataset = convertDataSourceToDatasetFile(
      source
    ) as RemoteDatasetFile & ZipDatasetFile;

    expect(isRemote(dataset)).to.be.true;
    expect(dataset.remoteFilename).to.equal(source.parent.uriSrc.name);
    expect(dataset.url).to.equal(source.parent.uriSrc.uri);
    expect(path.normalize(dataset.archivePath)).to.equal(
      path.normalize(source.archiveSrc.path)
    );
  });

  it('should convert a file derived from a local archive to a DatasetFile', () => {
    const source = {
      fileSrc: {
        file: new File([], 'myfile.dcm'),
        fileType: 'application/dicom',
      },
      archiveSrc: {
        path: 'innerPath/',
      },
      parent: {
        fileSrc: {
          file: new File([], 'archive.zip'),
          fileType: 'application/zip',
        },
      },
    };

    const dataset = convertDataSourceToDatasetFile(
      source
    ) as RemoteDatasetFile & ZipDatasetFile;

    expect(dataset.file.name).to.equal(source.fileSrc.file.name);
    expect(dataset.file.type).to.equal(source.fileSrc.fileType);
    expect(path.normalize(dataset.archivePath)).to.equal(
      path.normalize(source.archiveSrc.path)
    );
  });
});
