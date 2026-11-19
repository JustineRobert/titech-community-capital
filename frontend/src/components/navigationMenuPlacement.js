/**
 * Calculate a viewport-safe position for the Products/Services discovery panel.
 * Coordinates are physical viewport pixels so the same placement works in LTR
 * and RTL layouts. The panel itself is fixed-positioned and scroll-constrained.
 */
export function computeDiscoveryMenuPlacement({
  triggerRect,
  viewportWidth,
  viewportHeight,
  contentHeight = 0,
  maxWidth = 688,
  maxHeight = 576,
  margin = 12,
  gap = 8,
} = {}) {
  if (!triggerRect || !Number.isFinite(viewportWidth) || !Number.isFinite(viewportHeight) || viewportWidth <= 0 || viewportHeight <= 0) {
    return null;
  }

  const safeMargin = Math.max(0, Math.min(margin, viewportWidth / 2, viewportHeight / 2));
  const width = Math.max(0, Math.min(maxWidth, viewportWidth - safeMargin * 2));
  const center = triggerRect.left + (triggerRect.width / 2);
  const left = Math.max(safeMargin, Math.min(center - width / 2, viewportWidth - width - safeMargin));
  const availableHeight = Math.max(0, viewportHeight - safeMargin * 2);
  const targetHeight = Math.min(Math.max(0, contentHeight), maxHeight, availableHeight);
  const preferredTop = triggerRect.bottom + gap;
  const below = viewportHeight - preferredTop - safeMargin;

  let top = preferredTop;
  if (below < Math.min(targetHeight, 240) && triggerRect.top > targetHeight + safeMargin) {
    top = Math.max(safeMargin, triggerRect.top - targetHeight - gap);
  }

  if (viewportHeight - top - safeMargin < 160) {
    top = safeMargin;
  }

  const maxPanelHeight = Math.max(0, Math.min(maxHeight, viewportHeight - top - safeMargin));
  return Object.freeze({ left, top, width, maxHeight: maxPanelHeight });
}
