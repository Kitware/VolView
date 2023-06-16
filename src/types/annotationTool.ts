import { FrameOfReference } from '../utils/frameOfReference';

export type AnnotationTool = {
  id: string;
  /**
   * The associated image dataset.
   *
   * The tool currently does not store orientation info,
   * and so depends on the associated image space.
   */
  imageID: string;
  slice: number;
  frameOfReference: FrameOfReference;

  /**
   * Is this tool in placing mode
   */
  placing?: boolean;
  label?: string;
  labelName?: string;

  color: string;
  name: string;
};
