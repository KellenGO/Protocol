import type { Rect } from './formulaTreeLayout';

export interface CanvasTransform {
  panX: number;
  panY: number;
  scale: number;
}

export const MIN_SCALE = 0.3;
export const MAX_SCALE = 2.4;

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function screenToWorld(
  screenX: number,
  screenY: number,
  rect: { left: number; top: number },
  transform: CanvasTransform,
): { x: number; y: number } {
  return {
    x: (screenX - rect.left - transform.panX) / transform.scale,
    y: (screenY - rect.top - transform.panY) / transform.scale,
  };
}

export function worldToScreen(
  worldX: number,
  worldY: number,
  rect: { left: number; top: number },
  transform: CanvasTransform,
): { x: number; y: number } {
  return {
    x: rect.left + transform.panX + worldX * transform.scale,
    y: rect.top + transform.panY + worldY * transform.scale,
  };
}

/** 以 cursor 为锚点缩放，缩放前后 cursor 处的世界坐标不变 */
export function zoomAtCursor(
  transform: CanvasTransform,
  cursorX: number,
  cursorY: number,
  deltaY: number,
): CanvasTransform {
  const nextScale = clampScale(transform.scale * Math.exp(-deltaY * 0.0015));
  if (nextScale === transform.scale) return transform;
  const worldX = (cursorX - transform.panX) / transform.scale;
  const worldY = (cursorY - transform.panY) / transform.scale;
  return {
    panX: cursorX - worldX * nextScale,
    panY: cursorY - worldY * nextScale,
    scale: nextScale,
  };
}

/** 把内容包围盒整体居中到视口，上限 1.2，下限 MIN_SCALE */
export function fitTransform(
  content: Rect,
  viewportWidth: number,
  viewportHeight: number,
  padding = 64,
): CanvasTransform {
  if (content.width === 0 || content.height === 0) {
    return { panX: 0, panY: 0, scale: 1 };
  }
  const scale = clampScale(
    Math.min(
      (viewportWidth - padding * 2) / content.width,
      (viewportHeight - padding * 2) / content.height,
      1.2,
    ),
  );
  const panX = (viewportWidth - content.width * scale) / 2 - content.left * scale;
  const panY = (viewportHeight - content.height * scale) / 2 - content.top * scale;
  return { panX, panY, scale };
}

export function isPointInsideExpandedRect(
  point: { x: number; y: number },
  nodeRect: Rect,
  padding = 14,
): boolean {
  return (
    point.x >= nodeRect.left - padding &&
    point.x <= nodeRect.left + nodeRect.width + padding &&
    point.y >= nodeRect.top - padding &&
    point.y <= nodeRect.top + nodeRect.height + padding
  );
}
