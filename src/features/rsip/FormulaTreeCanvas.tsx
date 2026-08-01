import { useEffect, useMemo, useRef, useState } from 'react';
import { moveRsipFormula, type MoveRsipFormulaResult } from '../../lib/db';
import {
  collectSubtreeIds,
  findFormulaNode,
  findFormulaPath,
  getContentBounds,
  layoutForest,
  nodeRect,
  type FormulaTreeNode,
  type LayoutNode,
} from './formulaTreeLayout';
import {
  fitTransform,
  isPointInsideExpandedRect,
  screenToWorld,
  zoomAtCursor,
  type CanvasTransform,
} from './formulaTreeGeometry';

const DRAG_THRESHOLD = 6;

type InteractionState =
  | { type: 'idle' }
  | {
      type: 'pending-node-drag';
      nodeId: number;
      pointerId: number;
      startX: number;
      startY: number;
    }
  | {
      type: 'dragging-node';
      nodeId: number;
      pointerId: number;
      targetParentId: number | null;
      overRootZone: boolean;
    }
  | {
      type: 'panning';
      pointerId: number;
      startX: number;
      startY: number;
      initialPanX: number;
      initialPanY: number;
    };

export default function FormulaTreeCanvas({
  roots,
  selectedFormulaId,
  highlightId,
  onSelect,
  onMoved,
  onError,
}: {
  roots: FormulaTreeNode[];
  selectedFormulaId: number | null;
  highlightId?: number | null;
  onSelect: (id: number) => void;
  onMoved: (result: MoveRsipFormulaResult) => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const rootZoneRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const wheelRequestRef = useRef<{ cursorX: number; cursorY: number; deltaY: number } | null>(null);
  const didFitRef = useRef(false);
  const didDragRef = useRef(false);
  const lastHandledHighlightRef = useRef<number | null>(null);

  const [transform, setTransform] = useState<CanvasTransform>({ panX: 0, panY: 0, scale: 1 });
  const [interaction, setInteraction] = useState<InteractionState>({ type: 'idle' });
  const [moving, setMoving] = useState(false);
  const [dragPointer, setDragPointer] = useState<{
    screen: { x: number; y: number };
    world: { x: number; y: number };
  } | null>(null);

  const transformRef = useRef(transform);
  useEffect(() => {
    transformRef.current = transform;
  }, [transform]);

  const layout = useMemo(() => layoutForest(roots), [roots]);
  const itemsById = useMemo(
    () => new Map(layout.map((item) => [item.node.id, item])),
    [layout],
  );
  const contentBounds = useMemo(() => getContentBounds(layout), [layout]);
  const selectedPath = useMemo(
    () => (selectedFormulaId ? findFormulaPath(roots, selectedFormulaId) : []),
    [roots, selectedFormulaId],
  );
  const selectedPathIds = useMemo(
    () => new Set(selectedPath.map((node) => node.id)),
    [selectedPath],
  );

  // 首次加载数据后执行一次适应画布
  useEffect(() => {
    if (roots.length === 0 || didFitRef.current) return;
    didFitRef.current = true;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    setTransform(fitTransform(contentBounds, rect.width, rect.height));
  }, [roots, contentBounds]);

  // 滚轮缩放（React 的 onWheel 是 passive 监听，无法 preventDefault，必须用原生监听）
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      wheelRequestRef.current = {
        cursorX: event.clientX - rect.left,
        cursorY: event.clientY - rect.top,
        deltaY: event.deltaY,
      };
      if (frameRef.current === null) {
        frameRef.current = requestAnimationFrame(() => {
          frameRef.current = null;
          const wheel = wheelRequestRef.current;
          wheelRequestRef.current = null;
          if (wheel) {
            setTransform((t) => zoomAtCursor(t, wheel.cursorX, wheel.cursorY, wheel.deltaY));
          }
        });
      }
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, []);

  function revealNode(item: LayoutNode) {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const margin = 40;
    setTransform((t) => {
      const sx = t.panX + item.x * t.scale;
      const sy = t.panY + item.y * t.scale;
      let panX = t.panX;
      let panY = t.panY;
      if (sx < margin) panX += margin - sx;
      else if (sx > rect.width - margin) panX += rect.width - margin - sx;
      if (sy < margin) panY += margin - sy;
      else if (sy > rect.height - margin) panY += rect.height - margin - sy;
      return panX === t.panX && panY === t.panY ? t : { ...t, panX, panY };
    });
  }

  // 高亮/定位请求：只平移到可见（保持缩放）
  useEffect(() => {
    if (highlightId == null || highlightId === lastHandledHighlightRef.current) return;
    lastHandledHighlightRef.current = highlightId;
    const item = layout.find((i) => i.node.id === highlightId);
    if (!item) return;
    revealNode(item);
  }, [highlightId, layout]);

  function zoomByClick(multiplier: number) {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const cursorX = rect.width / 2;
    const cursorY = rect.height / 2;
    // 把期望倍率换算成 deltaY：scale * exp(-deltaY * 0.0015) = scale * multiplier
    const deltaY = -Math.log(multiplier) / 0.0015;
    setTransform((t) => zoomAtCursor(t, cursorX, cursorY, deltaY));
  }

  function fitAll() {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    setTransform(fitTransform(contentBounds, rect.width, rect.height));
  }

  function locateSelected() {
    if (selectedFormulaId === null) return;
    const item = layout.find((i) => i.node.id === selectedFormulaId);
    if (item) revealNode(item);
  }

  function subtreeHasActive(node: FormulaTreeNode): boolean {
    if (node.status === 'active') return true;
    return node.children.some(subtreeHasActive);
  }

  function isPointInRootZone(x: number, y: number): boolean {
    const zone = rootZoneRef.current;
    const viewport = viewportRef.current;
    if (!zone || !viewport) return false;
    const zoneRect = zone.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    return (
      x >= zoneRect.left - viewportRect.left &&
      x <= zoneRect.right - viewportRect.left &&
      y >= zoneRect.top - viewportRect.top &&
      y <= zoneRect.bottom - viewportRect.top
    );
  }

  function hitTest(world: { x: number; y: number }, draggedId: number): number | null {
    const banned = new Set<number>();
    const dragged = findFormulaNode(roots, draggedId);
    if (dragged) collectSubtreeIds(dragged, banned);
    let best: LayoutNode | null = null;
    let bestDistance = Infinity;
    for (const item of layout) {
      if (item.node.id === draggedId || banned.has(item.node.id)) continue;
      if (!isPointInsideExpandedRect(world, nodeRect(item), 14)) continue;
      const d = (world.x - item.x) ** 2 + (world.y - item.y) ** 2;
      if (d < bestDistance) {
        bestDistance = d;
        best = item;
      }
    }
    return best ? best.node.id : null;
  }

  function updateDragPointer(event: React.PointerEvent) {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const world = screenToWorld(event.clientX, event.clientY, rect, transformRef.current);
    setDragPointer({
      screen: { x: event.clientX - rect.left, y: event.clientY - rect.top },
      world,
    });
  }

  async function commitMove(nodeId: number, newParentId: number | null) {
    const moved = findFormulaNode(roots, nodeId);
    if (!moved) return;
    const target = newParentId === null ? null : findFormulaNode(roots, newParentId);
    let allowRollback = false;
    if (target && target.status === 'inactive' && subtreeHasActive(moved)) {
      if (!window.confirm('目标父节点尚未点亮。继续移动将熄灭该节点及其已点亮子节点。')) {
        return;
      }
      allowRollback = true;
    }
    setMoving(true);
    try {
      const result = await moveRsipFormula({
        id: nodeId,
        newParentId,
        allowStatusRollback: allowRollback,
      });
      await onMoved(result);
    } catch (err) {
      onError(String(err));
    } finally {
      setMoving(false);
    }
  }

  function handleNodePointerDown(event: React.PointerEvent, nodeId: number) {
    if (moving) return;
    event.stopPropagation();
    if (event.button !== 0) return;
    didDragRef.current = false;
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.setPointerCapture(event.pointerId);
    setInteraction({
      type: 'pending-node-drag',
      nodeId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    });
  }

  function handleViewportPointerDown(event: React.PointerEvent) {
    if ((event.target as HTMLElement).closest('.formula-graph-node')) return;
    if (moving) return;
    if (event.button !== 0 && event.button !== 1) return;
    event.preventDefault();
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.setPointerCapture(event.pointerId);
    setInteraction({
      type: 'panning',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      initialPanX: transformRef.current.panX,
      initialPanY: transformRef.current.panY,
    });
  }

  function handleViewportPointerMove(event: React.PointerEvent) {
    const current = interaction;
    if (current.type === 'idle' || event.pointerId !== current.pointerId) return;

    if (current.type === 'panning') {
      setTransform((t) => ({
        ...t,
        panX: current.initialPanX + (event.clientX - current.startX),
        panY: current.initialPanY + (event.clientY - current.startY),
      }));
      return;
    }

    if (current.type === 'pending-node-drag') {
      if (Math.hypot(event.clientX - current.startX, event.clientY - current.startY) <= DRAG_THRESHOLD) {
        return;
      }
      didDragRef.current = true;
      updateDragPointer(event);
      setInteraction({
        type: 'dragging-node',
        nodeId: current.nodeId,
        pointerId: current.pointerId,
        targetParentId: null,
        overRootZone: false,
      });
      return;
    }

    if (current.type === 'dragging-node') {
      updateDragPointer(event);
      const viewport = viewportRef.current;
      if (!viewport) return;
      const rect = viewport.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      const overRootZone = isPointInRootZone(px, py);
      const world = screenToWorld(event.clientX, event.clientY, rect, transformRef.current);
      const target = overRootZone ? null : hitTest(world, current.nodeId);
      setInteraction((prev) =>
        prev.type === 'dragging-node'
          ? { ...prev, targetParentId: target, overRootZone }
          : prev,
      );
    }
  }

  function handleViewportPointerUp(event: React.PointerEvent) {
    const current = interaction;
    if (current.type === 'idle' || event.pointerId !== current.pointerId) return;
    const viewport = viewportRef.current;
    if (viewport && viewport.hasPointerCapture(event.pointerId)) {
      viewport.releasePointerCapture(event.pointerId);
    }

    if (current.type === 'pending-node-drag') {
      onSelect(current.nodeId);
      setInteraction({ type: 'idle' });
      return;
    }

    if (current.type === 'dragging-node') {
      const dropWorld = dragPointer?.world;
      setDragPointer(null);
      setInteraction({ type: 'idle' });
      if (!dropWorld) return;
      if (!current.overRootZone && current.targetParentId === null) return; // 空白区域取消
      const target = current.overRootZone ? null : current.targetParentId;
      if (target === current.nodeId) return;
      commitMove(current.nodeId, target);
      return;
    }

    if (current.type === 'panning') {
      setInteraction({ type: 'idle' });
    }
  }

  return (
    <div
      ref={viewportRef}
      className={`formula-canvas-viewport${interaction.type === 'panning' ? ' is-panning' : ''}`}
      onPointerDown={handleViewportPointerDown}
      onPointerMove={handleViewportPointerMove}
      onPointerUp={handleViewportPointerUp}
      onPointerCancel={handleViewportPointerUp}
    >
      <div className="formula-canvas-controls" aria-label="画布控制">
        <button type="button" aria-label="缩小" onClick={() => zoomByClick(1 / 1.2)}>
          －
        </button>
        <span className="formula-canvas-scale">{Math.round(transform.scale * 100)}%</span>
        <button type="button" aria-label="放大" onClick={() => zoomByClick(1.2)}>
          ＋
        </button>
        <button type="button" onClick={fitAll}>适应画布</button>
        <button type="button" onClick={locateSelected} disabled={selectedFormulaId === null}>
          定位选中节点
        </button>
      </div>
      <div
        ref={rootZoneRef}
        className={`formula-canvas-root-zone${interaction.type === 'dragging-node' ? ' visible' : ''}${interaction.type === 'dragging-node' && interaction.overRootZone ? ' active' : ''}`}
        aria-hidden="true"
      >
        拖到这里，提升为根节点
      </div>
      <div
        className="formula-canvas-world"
        style={{ transform: `translate(${transform.panX}px, ${transform.panY}px) scale(${transform.scale})`, transformOrigin: '0 0' }}
      >
        <svg
          className="formula-graph-edges"
          width={contentBounds.width}
          height={contentBounds.height}
          viewBox={`0 0 ${contentBounds.width} ${contentBounds.height}`}
          aria-hidden="true"
        >
          {layout.map((item) => {
            if (item.parentId === null) return null;
            const parent = itemsById.get(item.parentId);
            if (!parent) return null;

            const startY = parent.y + parent.height / 2;
            const endY = item.y - item.height / 2;
            const middleY = startY + (endY - startY) * 0.5;
            const isSelectedEdge =
              selectedPathIds.has(parent.node.id) && selectedPathIds.has(item.node.id);
            const isActiveEdge =
              parent.node.status === 'active' && item.node.status === 'active';

            return (
              <path
                key={`${parent.node.id}-${item.node.id}`}
                className={`formula-graph-edge${isActiveEdge ? ' active' : ''}${isSelectedEdge ? ' selected' : ''}`}
                d={`M ${parent.x} ${startY} C ${parent.x} ${middleY}, ${item.x} ${middleY}, ${item.x} ${endY}`}
              />
            );
          })}
          {interaction.type === 'dragging-node' &&
            interaction.targetParentId !== null &&
            !interaction.overRootZone &&
            dragPointer &&
            (() => {
              const target = itemsById.get(interaction.targetParentId);
              if (!target) return null;
              const midY = (dragPointer.world.y + target.y) / 2;
              return (
                <path
                  className="formula-graph-drag-preview"
                  d={`M ${dragPointer.world.x} ${dragPointer.world.y} C ${dragPointer.world.x} ${midY}, ${target.x} ${midY}, ${target.x} ${target.y}`}
                />
              );
            })()}
        </svg>
        <div className="formula-graph-nodes" role="tree" aria-label="国策树习惯节点">
          {layout.map((item) => {
            const isSelected = selectedFormulaId === item.node.id;
            return (
              <button
                key={item.node.id}
                type="button"
                className={`formula-graph-node${item.node.status === 'active' ? ' active' : ''}${item.depth === 0 ? ' root' : ''}${isSelected ? ' selected' : ''}${interaction.type === 'dragging-node' && interaction.nodeId === item.node.id ? ' is-dragging' : ''}${interaction.type === 'dragging-node' && interaction.targetParentId === item.node.id ? ' is-drop-target' : ''}`}
                style={{ left: item.x, top: item.y, width: item.width, minHeight: item.height }}
                role="treeitem"
                aria-level={item.depth + 1}
                aria-selected={isSelected}
                aria-label={`${item.node.title}，${item.node.status === 'active' ? '已点亮' : '未点亮'}`}
                title={item.node.title}
                onPointerDown={(event) => handleNodePointerDown(event, item.node.id)}
                onClick={() => {
                  if (!didDragRef.current) onSelect(item.node.id);
                }}
              >
                <span className="formula-graph-node-dot" aria-hidden="true" />
                <span className="formula-graph-node-title">{item.node.title}</span>
              </button>
            );
          })}
          {interaction.type === 'dragging-node' && dragPointer && (() => {
            const moved = findFormulaNode(roots, interaction.nodeId);
            if (!moved) return null;
            return (
              <div
                className="formula-graph-node-drag-ghost"
                style={{ left: dragPointer.world.x, top: dragPointer.world.y }}
              >
                <span className="formula-graph-node-dot" aria-hidden="true" />
                <span className="formula-graph-node-title">{moved.title}</span>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
