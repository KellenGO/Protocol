import {
  fitTransform,
  isPointInsideExpandedRect,
  screenToWorld,
  worldToScreen,
  zoomAtCursor,
  clampScale,
  MIN_SCALE,
  MAX_SCALE,
  type CanvasTransform,
} from './formulaTreeGeometry.ts';

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertClose(actual: number, expected: number, message: string, epsilon = 1e-9) {
  if (Math.abs(actual - expected) > epsilon) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

const rect = { left: 50, top: 30 };
const transform: CanvasTransform = { panX: 120, panY: 80, scale: 1.5 };

// worldToScreen(screenToWorld(point)) 还原原坐标
{
  const screen = { x: 200, y: 140 };
  const world = screenToWorld(screen.x, screen.y, rect, transform);
  const back = worldToScreen(world.x, world.y, rect, transform);
  assertClose(back.x, screen.x, 'roundtrip x');
  assertClose(back.y, screen.y, 'roundtrip y');
}

// 缩放前后鼠标锚点对应的世界坐标不变
// （zoomAtCursor 的 cursor 是视口相对坐标，screenToWorld 传页面坐标 + rect 偏移）
{
  const cursor = { x: 300, y: 220 };
  const before = screenToWorld(cursor.x, cursor.y, rect, transform);
  const zoomed = zoomAtCursor(transform, cursor.x - rect.left, cursor.y - rect.top, -120);
  const after = screenToWorld(cursor.x, cursor.y, rect, zoomed);
  assertClose(after.x, before.x, 'anchor world x stable');
  assertClose(after.y, before.y, 'anchor world y stable');
  assertEqual(zoomed.scale > transform.scale, true, 'negative deltaY (scroll up) zooms in');
  const zoomedOut = zoomAtCursor(transform, cursor.x - rect.left, cursor.y - rect.top, 120);
  assertEqual(zoomedOut.scale < transform.scale, true, 'positive deltaY (scroll down) zooms out');
}

// 边界限制
{
  assertEqual(clampScale(0.1), MIN_SCALE, 'clamps to MIN_SCALE');
  assertEqual(clampScale(9), MAX_SCALE, 'clamps to MAX_SCALE');
  const zoomedOut = zoomAtCursor(transform, 100, 100, 1e9);
  assertEqual(zoomedOut.scale, MIN_SCALE, 'wheel zoom out clamps at MIN_SCALE');
  const zoomedIn = zoomAtCursor(transform, 100, 100, -1e9);
  assertEqual(zoomedIn.scale, MAX_SCALE, 'wheel zoom in clamps at MAX_SCALE');
}

// fitTransform 与缩放范围
{
  const content = { left: 96, top: 96, width: 1000, height: 500 };
  const fitted = fitTransform(content, 900, 600);
  const worldLeft = screenToWorld(0, 0, { left: 0, top: 0 }, fitted);
  const worldRight = screenToWorld(900, 0, { left: 0, top: 0 }, fitted);
  assertEqual(worldLeft.x <= content.left + 1, true, 'fit keeps content visible on the left');
  assertEqual(worldRight.x >= content.left + content.width - 1, true, 'fit keeps content visible on the right');
  assertEqual(fitted.scale >= MIN_SCALE && fitted.scale <= 1.2 + 1e-9, true, 'fit scale within [MIN_SCALE, 1.2]');
}

// isPointInsideExpandedRect
{
  const r = { left: 100, top: 100, width: 50, height: 50 };
  assertEqual(isPointInsideExpandedRect({ x: 100, y: 100 }, r), true, 'center point inside');
  assertEqual(isPointInsideExpandedRect({ x: 200, y: 200 }, r), false, 'far point outside');
  assertEqual(isPointInsideExpandedRect({ x: 125, y: 90 }, r), true, 'point inside padding region');
  assertEqual(isPointInsideExpandedRect({ x: 125, y: 80 }, r), false, 'point beyond padding');
}

console.log('formulaTreeGeometry tests passed');
