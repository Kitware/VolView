import * as path from 'path';
import * as fs from 'fs';
import { TEMP_DIR } from '../../wdio.shared.conf';

// File is not automatically deleted
export const downloadFile = async (url: string, fileName: string) => {
  const savePath = path.join(TEMP_DIR, fileName);
  if (!fs.existsSync(savePath)) {
    const response = await fetch(url);
    const data = await response.arrayBuffer();
    const buffer = Buffer.from(data);
    fs.writeFileSync(savePath, buffer);
  }
  return savePath;
};
