import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Page } from '@playwright/test';
import { TEMP_DIR } from './e2eRun';

/**
 * Files a test writes under TEMP_DIR, where the page reaches them at
 * `/tmp/<name>`. Whatever it created is removed when its owner finishes.
 */
export const createScratch = () => {
  const created: string[] = [];
  const track = (filePath: string) => {
    created.push(filePath);
    return filePath;
  };
  return {
    /** Absolute path of `name` under TEMP_DIR, without creating or tracking it. */
    path: (name: string) => path.join(TEMP_DIR, name),
    writeFile: (name: string, data: string | Uint8Array) => {
      const filePath = track(path.join(TEMP_DIR, name));
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, data);
      return filePath;
    },
    makeDir: (name: string) => {
      const dir = track(path.join(TEMP_DIR, name));
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    },
    track,
    cleanup: () =>
      created
        .splice(0)
        .forEach((filePath) =>
          fs.rmSync(filePath, { recursive: true, force: true })
        ),
  };
};

export type Scratch = ReturnType<typeof createScratch>;

/**
 * Runs `trigger`, waits for the download it starts, and saves the finished file
 * under TEMP_DIR with the name the page gave it. Returns the absolute path.
 */
export const createSaveDownload =
  (page: Page, scratch: Scratch) => async (trigger: () => Promise<unknown>) => {
    const [download] = await Promise.all([
      // A large save outlasts the wait budget; the test's budget bounds it.
      page.waitForEvent('download', { timeout: 0 }),
      trigger(),
    ]);
    const filePath = scratch.track(
      path.join(TEMP_DIR, download.suggestedFilename())
    );
    await download.saveAs(filePath);
    return filePath;
  };

export type SaveDownload = ReturnType<typeof createSaveDownload>;
