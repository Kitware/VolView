import { Tags } from '@/src/core/dicomTags';

/**
 * Real Imaging Data Commons (IDC) series behind the acquisition-split rules.
 *
 * Entries are keyed by SeriesInstanceUID: bucket paths, folder UUIDs, and
 * portal URLs all change between IDC releases, the UID does not. Fetch one by
 * searching the UID at portal.imaging.datacommons.cancer.gov, or with the
 * idc-index package:
 *
 *     from idc_index import IDCClient
 *     IDCClient().download_from_selection(
 *       seriesInstanceUID='<uid>', downloadDir='.')
 *
 * `groups` mirrors the real per-group tag values and slice layout, with
 * positions projected onto the slice normal, in mm.
 */

export type SliceGroup = {
  /** Tag values stamped on every slice of the group, keyed by 'gggg|eeee'. */
  tags: Record<string, string>;
  /** Slice positions along the normal, in mm. */
  zs: number[];
};

export type IdcSeriesFixture = {
  seriesInstanceUID: string;
  seriesDescription: string;
  vendor: string;
  /** What the series is and why it forces the rule it tests. */
  why: string;
  groups?: SliceGroup[];
};

const steps = (start: number, count: number, step: number) =>
  Array.from({ length: count }, (_, i) => start + i * step);

export const dceEightPhase: IdcSeriesFixture = {
  seriesInstanceUID:
    '1.3.6.1.4.1.14519.5.2.1.7695.4164.334885423614895574619945040495',
  seriesDescription: 'ISPY2: VOLSER: uni-lateral cropped: original DCE',
  vendor: 'GE',
  why:
    'DCE breast MR: eight timepoints re-scan one identical 80-slice Z range ' +
    'in a single series. No AcquisitionNumber at all; only ' +
    'TemporalPositionIdentifier separates the timepoints. Loaded merged, ' +
    'every position appears eight times.',
  groups: steps(0, 8, 1).map((phase) => ({
    tags: { [Tags.TemporalPositionIdentifier]: String(phase) },
    zs: steps(-81.198, 80, 2.0),
  })),
};

export const dceSevenPhasePhilips: IdcSeriesFixture = {
  seriesInstanceUID:
    '1.3.6.1.4.1.14519.5.2.1.7695.4164.327395145625810010102069976322',
  seriesDescription: 'ISPY2: 15ML OMNI T1 FS DYN SENSE 5',
  vendor: 'Philips',
  why:
    'DCE breast MR: seven timepoints (TemporalPositionIdentifier 1 through ' +
    '7), 158 slices each over one Z range. Shows the split holds across ' +
    'vendors and with 1-based numbering.',
  groups: steps(1, 7, 1).map((phase) => ({
    tags: { [Tags.TemporalPositionIdentifier]: String(phase) },
    zs: steps(-83.107, 158, 1.0),
  })),
};

export const dixonDualEcho: IdcSeriesFixture = {
  seriesInstanceUID:
    '1.3.6.1.4.1.14519.5.2.1.9203.4004.413147664284321913537786821717',
  seriesDescription: 'T1 AX IN_OUT_160 TR MBH',
  vendor: 'Siemens',
  why:
    'In-phase/opposed-phase Dixon in one series: two echoes (TE 2.4/5.04) ' +
    'over one identical 34-slice range, one AcquisitionNumber, no ' +
    'TemporalPositionIdentifier. Only EchoNumbers separates them; the ' +
    'categorize pipeline cannot (SequenceName is *fl2d2 for both echoes).',
  groups: ['1', '2'].map((echo) => ({
    tags: {
      [Tags.AcquisitionNumber]: '1',
      [Tags.EchoNumbers]: echo,
    },
    zs: steps(-107.502, 34, 7.8),
  })),
};

export const dixonUnevenEchoes: IdcSeriesFixture = {
  seriesInstanceUID:
    '1.3.6.1.4.1.14519.5.2.1.1620.1226.196512451812657389463383990773',
  seriesDescription: 'AXL_IN_OUT_ABD',
  vendor: 'Siemens',
  why:
    'Dixon dual-echo where echo 1 has 13 slices and echo 2 has 12 over the ' +
    'same range; unequal group sizes must still split.',
  groups: [
    {
      tags: { [Tags.AcquisitionNumber]: '1', [Tags.EchoNumbers]: '1' },
      zs: steps(0, 13, 7.8),
    },
    {
      tags: { [Tags.AcquisitionNumber]: '1', [Tags.EchoNumbers]: '2' },
      zs: steps(0, 12, 7.8),
    },
  ],
};

export const bilateralSagittalSlabs: IdcSeriesFixture = {
  seriesInstanceUID:
    '1.3.6.1.4.1.14519.5.2.1.66737955842913643997059729379406867951',
  seriesDescription: 'ISPY2: SAG IR',
  vendor: 'GE',
  why:
    'Bilateral sagittal breast slabs: StackID 1 and 2 cover two 4mm stacks ' +
    'with a 42mm gap, one orientation, one acquisition, all positions ' +
    'distinct. This series is why StackID is NOT a split discriminator: the ' +
    'slabs form one sound volume, and only the overlap gate keeps a ' +
    'StackID-like tag from tearing it apart.',
  groups: [
    {
      tags: { [Tags.AcquisitionNumber]: '1', '0020|9056': '1' },
      zs: steps(-156.488, 31, 4.0),
    },
    {
      tags: { [Tags.AcquisitionNumber]: '1', '0020|9056': '2' },
      zs: steps(5.951, 35, 4.0),
    },
  ],
};

export const partialTemporalTags: IdcSeriesFixture = {
  seriesInstanceUID:
    '1.3.6.1.4.1.14519.5.2.1.7695.4164.232713885104107279235403827078',
  seriesDescription: 'ISPY2: Ax Vibrant PRE/POST',
  vendor: 'GE',
  why:
    'Seven acquisitions re-scanning one range, but ' +
    'TemporalPositionIdentifier is present on only part of the slices. ' +
    'AcquisitionNumber must do the split, and the incomplete temporal tag ' +
    'must not sub-split or block anything.',
  groups: [
    {
      tags: {
        [Tags.AcquisitionNumber]: '1',
        [Tags.TemporalPositionIdentifier]: '1',
      },
      zs: steps(-60, 36, 2.0),
    },
    // The rest of acquisition 1 carries no temporal tag at all.
    { tags: { [Tags.AcquisitionNumber]: '1' }, zs: steps(12, 36, 2.0) },
    ...steps(2, 6, 1).map((acq) => ({
      tags: {
        [Tags.AcquisitionNumber]: String(acq),
        [Tags.TemporalPositionIdentifier]: String(acq),
      },
      zs: steps(-60, 72, 2.0),
    })),
  ],
};

export const doubledAcquisition: IdcSeriesFixture = {
  seriesInstanceUID:
    '1.3.6.1.4.1.14519.5.2.1.7695.1700.103847508594300579711113977161',
  seriesDescription: 'IR-SPGR-SAG',
  vendor: 'GE',
  why:
    'Acquisition 1 holds 74 slices; acquisition 2 holds 148 slices at those ' +
    'same 74 positions. The split is right and the acquisition-2 volume must ' +
    'still carry the duplicate-position warning. Same shape in IDC series ' +
    '1.3.6.1.4.1.14519.5.2.1.7695.2311.133871731749882407434486842181 ' +
    '(LEFT - Dynamic-3dfgre, acquisition values 0 and 2).',
  groups: [
    { tags: { [Tags.AcquisitionNumber]: '1' }, zs: steps(-214.177, 74, 2.5) },
    {
      tags: { [Tags.AcquisitionNumber]: '2' },
      zs: [...steps(-214.177, 74, 2.5), ...steps(-214.177, 74, 2.5)],
    },
  ],
};
