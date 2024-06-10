import { MutableRefObject, useLayoutEffect, useState } from "react";

export type ViewportIntersectionInfo = {
  /**
   * Fraction of the element that is visible in the viewport along the x-axis
   */
  visibleFractionX: number,
  /**
   * Fraction of the element that is visible in the viewport along the y-axis
   */
  visibleFractionY: number,
  /**
   * Fraction of the element that is visible in the viewport
   */
  visibleFraction: number,
  /**
   * like `visibleFractionX` but does not decrease as the element exits through the right of the viewport
   * - <= 0 when the element is not visible
   * - \>= 1 when the element is fully visible
   */
  visibleFractionXProgressive: number,
  /**
   * like `visibleFractionY` but does not decrease as the element exits through the top of the viewport
   * 
   * - <= 0 when the element is not visible
   * - \>= 1 when the element is fully visible
   */
  visibleFractionYProgressive: number,
  /**
   * like visibleFraction but only increases when the element is scrolled into view and does not decrease when the element is scrolled out of view
   */
  visibleFractionProgressive: number,
  /**
   * -1 if the center of the element is on the left half of the viewport
   */
  signX: number,
  /**
   * -1 if the center of the element is on the top half of the viewport
   */
  signY: number,
};

/**
 * Returns metrics about the intersection of the element with the viewport
 */
export function useViewportIntersection(
  ref: MutableRefObject<Element | null>,
  onChange: (info: ViewportIntersectionInfo) => void
): void {
  useLayoutEffect(() => {
    const onScroll = () => {
      if (!ref.current) return;
      const rect = ref.current.getBoundingClientRect();

      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      const visibleWidthProgressive = viewportWidth - rect.left;
      const visibleHeightProgressive = viewportHeight - rect.top;
      const visibleWidth = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
      const visibleHeight = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));

      const totalWidth = rect.width;
      const totalHeight = rect.height;

      const visibleFractionX = (visibleWidth / totalWidth);
      const visibleFractionY = (visibleHeight / totalHeight);

      const visibleFractionXProgressive = (visibleWidthProgressive / totalWidth);
      const visibleFractionYProgressive = (visibleHeightProgressive / totalHeight);

      const signX = ((rect.left + rect.width / 2) < (viewportWidth / 2) ? -1 : 1);
      const signY = ((rect.top + rect.height / 2) < (viewportHeight / 2) ? -1 : 1);

      onChange({
        visibleFractionX,
        visibleFractionY,
        visibleFraction: Math.min(visibleFractionX, visibleFractionY),
        visibleFractionXProgressive,
        visibleFractionYProgressive,
        visibleFractionProgressive: Math.min(visibleFractionXProgressive, visibleFractionYProgressive),
        signX,
        signY,
      });
    };

    window.addEventListener('scroll', onScroll);
    window.addEventListener('resize', onScroll);

    // Initial call to set the values
    onScroll();

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [ref]);
}

export function useViewportIntersectionState(ref: MutableRefObject<Element | null>): ViewportIntersectionInfo {
  const [info, setInfo] = useState<ViewportIntersectionInfo>({
    visibleFractionX: 0,
    visibleFractionY: 0,
    visibleFraction: 0,
    visibleFractionXProgressive: 0,
    visibleFractionYProgressive: 0,
    visibleFractionProgressive: 0,
    signX: 0,
    signY: 0,
  });

  useViewportIntersection(ref, setInfo);

  return info;
}