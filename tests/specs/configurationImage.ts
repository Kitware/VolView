import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TEMP_DIR } from '../../wdio.shared.conf';

export const writeConfigImages = (stem: string) => {
  const header = [
    'NRRD0005',
    'type: unsigned char',
    'dimension: 3',
    'sizes: 8 8 8',
    'space: left-posterior-superior',
    'space directions: (1,0,0) (0,1,0) (0,0,1)',
    'space origin: (0,0,0)',
    'encoding: ascii',
  ];
  const pixels = Array.from({ length: 512 }, (_, i) =>
    i % 8 > 2 ? 1 : 0
  ).join(' ');
  writeFileSync(
    join(TEMP_DIR, `${stem}.nrrd`),
    `${header.join('\n')}\n\n${pixels}`
  );
  writeFileSync(
    join(TEMP_DIR, `${stem}.seg.nrrd`),
    `${header.join('\n')}\nSegment0_LabelValue:=1\nSegment0_Name:=Matched mask\n\n${pixels}`
  );
};
