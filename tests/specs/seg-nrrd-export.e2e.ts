import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import JSZip from 'jszip';
import { volViewPage } from '../pageobjects/volview.page';
import { TEMP_DIR } from '../../wdio.shared.conf';
import { waitForFileExists } from './utils';
import { ONE_CT_SLICE_DICOM, openConfigAndDataset } from './configTestUtils';

/**
 * Parse NRRD header key-value pairs from a buffer (handles gzip).
 */
const parseNrrdHeader = (buf: Buffer): Map<string, string> => {
  const raw = buf[0] === 0x1f && buf[1] === 0x8b ? zlib.gunzipSync(buf) : buf;
  const text = raw.toString('ascii', 0, Math.min(raw.length, 16384));
  const headerEnd = text.indexOf('\n\n');
  const headerText = headerEnd >= 0 ? text.slice(0, headerEnd) : text;

  const entries = new Map<string, string>();
  headerText.split('\n').forEach((line) => {
    const sepIdx = line.indexOf(':=');
    if (sepIdx >= 0) {
      entries.set(line.slice(0, sepIdx).trim(), line.slice(sepIdx + 2).trim());
      return;
    }
    const colonIdx = line.indexOf(':');
    if (colonIdx >= 0 && !line.startsWith('#') && !line.startsWith('NRRD')) {
      entries.set(
        line.slice(0, colonIdx).trim(),
        line.slice(colonIdx + 1).trim()
      );
    }
  });
  return entries;
};

describe('Slicer-compatible seg.nrrd export', function () {
  this.timeout(120_000);

  it('session save includes Slicer metadata in seg.nrrd labelmap', async () => {
    const config = { io: { segmentGroupSaveFormat: 'seg.nrrd' } };
    await openConfigAndDataset(config, 'seg-nrrd-export', ONE_CT_SLICE_DICOM);

    // Activate paint tool — creates a segment group
    await volViewPage.activatePaint();

    // Paint a stroke so the labelmap has data
    const views2D = await volViewPage.getViews2D();
    const canvas = await views2D[0].$('canvas');
    const location = await canvas.getLocation();
    const size = await canvas.getSize();
    const cx = Math.round(location.x + size.width / 2);
    const cy = Math.round(location.y + size.height / 2);

    await browser
      .action('pointer')
      .move({ x: cx, y: cy })
      .down()
      .move({ x: cx + 20, y: cy })
      .up()
      .perform();

    // Save session — downloads a .volview.zip containing the seg.nrrd
    const sessionFileName = await volViewPage.saveSession();
    const downloadedPath = path.join(TEMP_DIR, sessionFileName);

    await waitForFileExists(downloadedPath, 30_000);

    // Wait for file to be fully written
    await browser.waitUntil(
      () => {
        try {
          return fs.statSync(downloadedPath).size > 0;
        } catch {
          return false;
        }
      },
      {
        timeout: 10_000,
        interval: 500,
        timeoutMsg: 'Downloaded session zip remained 0 bytes',
      }
    );

    // Extract the seg.nrrd file from the session zip
    const zipData = fs.readFileSync(downloadedPath);
    const zip = await JSZip.loadAsync(zipData);

    const segNrrdFile = Object.keys(zip.files).find((name) =>
      name.endsWith('.seg.nrrd')
    );
    expect(segNrrdFile).toBeDefined();

    const nrrdBuffer = Buffer.from(
      await zip.files[segNrrdFile!].async('arraybuffer')
    );
    const header = parseNrrdHeader(nrrdBuffer);

    // Global segmentation fields
    expect(header.get('Segmentation_MasterRepresentation')).toBe(
      'Binary labelmap'
    );
    expect(header.get('Segmentation_ContainedRepresentationNames')).toBe(
      'Binary labelmap|'
    );
    expect(header.get('Segmentation_ReferenceImageExtentOffset')).toBe('0 0 0');

    // Per-segment fields — default first segment is "Segment 1" with value 1
    expect(header.get('Segment0_ID')).toBe('Segment_1');
    expect(header.get('Segment0_Name')).toBe('Segment 1');
    expect(header.get('Segment0_LabelValue')).toBe('1');
    expect(header.get('Segment0_Layer')).toBe('0');
    expect(header.get('Segment0_Extent')).toBeDefined();
    expect(header.get('Segment0_Tags')).toBe('|');

    // Color should be 3 space-separated floats between 0 and 1
    const colorStr = header.get('Segment0_Color');
    expect(colorStr).toBeDefined();
    const colorParts = colorStr!.split(' ').map(Number);
    expect(colorParts).toHaveLength(3);
    colorParts.forEach((c) => {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    });
  });
});
