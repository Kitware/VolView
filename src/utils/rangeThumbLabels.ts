/**
 * Directive naming a VRangeSlider's two thumbs. VRangeSlider has no
 * endpoint-name props, so this labels its two focus targets.
 */
export const rangeThumbLabels =
  (first: string, second: string) => (element: HTMLElement) => {
    const thumbs = element.querySelectorAll('[role="slider"]');
    thumbs[0]?.setAttribute('aria-label', first);
    thumbs[1]?.setAttribute('aria-label', second);
  };
