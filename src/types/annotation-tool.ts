import { FrameOfReference } from '../utils/frameOfReference';
import type { ProcessingResultSource } from './index';

export type ToolID = string & { __type: 'ToolID' };

export type AnnotationTool = {
  id: ToolID;
  /**
   * The associated image dataset.
   *
   * The tool currently does not store orientation info,
   * and so depends on the associated image space.
   */
  imageID: string;
  slice: number;
  frameOfReference: FrameOfReference;

  // Temporal cursor. Present iff the bound image has a time axis (cine).
  frame?: number;

  /**
   * Is this tool unfinished?
   */
  placing?: boolean;

  label?: string;
  labelName?: string;

  color: string;
  strokeWidth?: number;

  name: string;

  hidden?: boolean;

  /*
   * Arbitrary key-value pairs associated with the annotation.
   */
  metadata?: Record<string, string>;

  // Provenance of a job-produced tool; absent on hand-placed ones.
  source?: ProcessingResultSource;
};
