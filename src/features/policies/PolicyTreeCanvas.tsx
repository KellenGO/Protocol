import { useEffect, useMemo, useRef, useState } from 'react';
import type { TreeNodeWithPolicy } from '../../types';
import { reparentTreeNode, reorderTreeNode } from '../../lib/db/policies';
import {
  buildPolicyTree,
  collectSubtreeIds,
  findPolicyNode,
  getContentBounds,
  layoutForest,
  nodeRect,
  type LayoutNode,
} from './treeLayout';
import {
  fitTransform,
  isPointInsideExpandedRect,
  screenToWorld,
  zoomAtCursor,
  type CanvasTransform,
} from './treeGeometry';

const DRAG_THRESHOLD = 6;
/** 同层行 y 容差（世界坐标）：指针与该行中心距离在此范围内才考虑插入 */
const INSERT_BAND_TOLERANCE = 44;
/** 首/末兄弟外侧的插入检测延伸范围 */
const INSERT_EDGE_ZONE = 48;
/** 首/末兄弟外侧指示线的宽度 */
const INSERT_EDGE_MARKER_WIDTH = 56;

/** 同级插入目标：插到 parentId 的子列表中 order 位置（order 为移出被拖节点后的兄弟列表索引） */
interface InsertTarget {
  parentId: number | null;
  order: number;
  left: number;
  right: number;
  rowY: number;
}

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
      insertTarget: InsertTarget | null;
    }
  | {
      type: 'panning';
      pointerId: number;
      startX: number;
      startY: number;
      initialPanX: number;
      initialPanY: number;
    };

interface Props {
  treeNodes: TreeNodeWithPolicy[];
  selectedNodeId: number | null;
  isDetailPanelOpen: boolean;
  onSelect: (nodeId: number | null) => void;
  onMoved: (result: unknown) => void | Promise<void>;
  onError: (msg: string) => void;
}

export default function PolicyTreeCanvas({
  treeNodes,
  selectedNodeId,
  isDetailPanelOpen,
  onSelect,
  onMoved,
  onError,
}: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const rootZoneRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const wheelRequestRef = useRef<{ cursorX: number; cursorY: number; deltaY: number } | null>(null);
  const didFitRef = useRef(false);
  const didDragRef = useRef(false);
  const didPanRef = useRef(false);

  const [transform, setTransform] = useState<CanvasTransform>({ panX: 0, panY: 0, scale: 1 });
  const [interaction, setInteraction] = useState<InteractionState>({ type: 'idle' });
  const [moving, setMoving] = useState(false);
  const [moveAnimating, setMoveAnimating] = useState(false);
  const [flashId, setFlashId] = useState<number | null>(null);
  const flashTimerRef = useRef<number | null>(null);
  const [dragPointer, setDragPointer] = useState<{
    screen: { x: number; y: number };
    world: { x: number; y: number };
  } | null>(null);

  const transformRef = useRef(transform);
  useEffect(() => {
    transformRef.current = transform;
  }, [transform]);

  // 卸载时清理闪烁计时器，避免卸载后 setState
  useEffect(() => {
    return () => {
      if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
    };
  }, []);

  const roots = useMemo(() => buildPolicyTree(treeNodes), [treeNodes]);
  const layout = useMemo(() => layoutForest(roots), [roots]);
  const itemsById = useMemo(
    () => new Map(layout.map((item) => [item.node.node.id, item])),
    [layout],
  );
  const contentBounds = useMemo(() => getContentBounds(layout), [layout]);
  // 选中态只在详情面板打开时生效（面板关闭即视为未选中）
  const activeSelectedId = isDetailPanelOpen ? selectedNodeId : null;

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
    if (activeSelectedId === null) return;
    const item = layout.find((i) => i.node.node.id === activeSelectedId);
    if (item) revealNode(item);
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

  /** 被拖节点及其子孙所在的集合，用于禁止拖入自身子树 */
  function bannedSubtreeIds(draggedId: number): Set<number> {
    const banned = new Set<number>();
    const dragged = findPolicyNode(roots, draggedId);
    if (dragged) collectSubtreeIds(dragged, banned);
    return banned;
  }

  function hitTest(world: { x: number; y: number }, draggedId: number): number | null {
    const banned = bannedSubtreeIds(draggedId);
    let best: LayoutNode | null = null;
    let bestDistance = Infinity;
    for (const item of layout) {
      if (item.node.node.id === draggedId || banned.has(item.node.node.id)) continue;
      if (!isPointInsideExpandedRect(world, nodeRect(item), 14)) continue;
      const d = (world.x - item.x) ** 2 + (world.y - item.y) ** 2;
      if (d < bestDistance) {
        bestDistance = d;
        best = item;
      }
    }
    return best ? best.node.node.id : null;
  }

  /**
   * 同级插入检测：指针位于同一父节点下相邻两个兄弟之间的水平间隙时，
   * 返回插入位置（order 为移除被拖节点后该兄弟列表中的索引，与后端语义一致）。
   */
  function findInsertTarget(
    world: { x: number; y: number },
    draggedId: number,
  ): InsertTarget | null {
    // 指针落在某个节点矩形内时不提供插入（由 hitTest 处理"拖到节点上成为子节点"）
    for (const item of layout) {
      const r = nodeRect(item);
      if (world.x >= r.left && world.x <= r.left + r.width && world.y >= r.top && world.y <= r.top + r.height) {
        return null;
      }
    }

    const banned = bannedSubtreeIds(draggedId);
    let best: InsertTarget | null = null;
    let bestYDistance = Infinity;

    // 按深度分组（同一深度的节点在同一水平行）
    const byDepth = new Map<number, LayoutNode[]>();
    for (const item of layout) {
      if (item.node.node.id === draggedId || banned.has(item.node.node.id)) continue;
      if (!byDepth.has(item.depth)) byDepth.set(item.depth, []);
      byDepth.get(item.depth)!.push(item);
    }

    for (const [, items] of byDepth) {
      const rowY = items[0].y;
      const yDistance = Math.abs(world.y - rowY);
      if (yDistance > INSERT_BAND_TOLERANCE || yDistance >= bestYDistance) continue;

      // 按父节点分组（同级兄弟同一父节点）
      const byParent = new Map<number, LayoutNode[]>();
      for (const item of items) {
        const key = item.parentId === null ? -1 : item.parentId;
        if (!byParent.has(key)) byParent.set(key, []);
        byParent.get(key)!.push(item);
      }

      for (const [key, group] of byParent) {
        const parentId = key === -1 ? null : key;
        // 禁止插入到被拖节点的子孙列表（会成环）
        if (parentId !== null && (parentId === draggedId || banned.has(parentId))) continue;
        // 布局即从左到右排列兄弟
        group.sort((a, b) => a.x - b.x);
        for (let i = 0; i < group.length; i++) {
          const item = group[i];
          const leftEdge = item.x - item.width / 2;
          const rightEdge = item.x + item.width / 2;
          let candidate: InsertTarget | null = null;
          if (i === 0 && world.x >= leftEdge - INSERT_EDGE_ZONE && world.x < leftEdge) {
            // 第一个兄弟之前
            candidate = {
              parentId,
              order: 0,
              left: world.x - INSERT_EDGE_MARKER_WIDTH / 2,
              right: world.x + INSERT_EDGE_MARKER_WIDTH / 2,
              rowY,
            };
          } else if (i === group.length - 1 && world.x > rightEdge && world.x <= rightEdge + INSERT_EDGE_ZONE) {
            // 最后一个兄弟之后 → 追加到末尾
            candidate = {
              parentId,
              order: group.length,
              left: world.x - INSERT_EDGE_MARKER_WIDTH / 2,
              right: world.x + INSERT_EDGE_MARKER_WIDTH / 2,
              rowY,
            };
          } else if (i > 0) {
            const prev = group[i - 1];
            const prevRight = prev.x + prev.width / 2;
            if (world.x > prevRight && world.x < rightEdge) {
              // 两个兄弟之间 → 插到 item 之前
              candidate = { parentId, order: i, left: prevRight, right: rightEdge, rowY };
            }
          }
          if (candidate) {
            best = candidate;
            bestYDistance = yDistance;
          }
        }
      }
    }
    return best;
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

  async function commitMove(nodeId: number, newParentId: number | null, newOrder?: number) {
    const moved = findPolicyNode(roots, nodeId);
    if (!moved) return;
    const oldParentNodeId = moved.node.parent_node_id;
    setMoving(true);
    try {
      let result: unknown;
      if (oldParentNodeId === newParentId) {
        // 同父节点：仅调整 sibling_order
        if (newOrder === undefined || newOrder === moved.node.sibling_order) {
          return; // 位置没有变化，无需提交
        }
        result = await reorderTreeNode({ nodeId, newSiblingOrder: newOrder });
      } else {
        result = await reparentTreeNode({
          nodeId,
          newParentNodeId: newParentId,
          newSiblingOrder: newOrder ?? null,
        });
      }
      setFlashId(nodeId);
      if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
      flashTimerRef.current = window.setTimeout(() => setFlashId(null), 1000);
      await onMoved(result);
      setMoveAnimating(true);
      window.setTimeout(() => setMoveAnimating(false), 220);
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
    didPanRef.current = false;
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
      if (
        !didPanRef.current &&
        Math.hypot(event.clientX - current.startX, event.clientY - current.startY) > DRAG_THRESHOLD
      ) {
        didPanRef.current = true;
      }
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
        insertTarget: null,
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
      let targetParentId: number | null = null;
      let insertTarget: InsertTarget | null = null;
      if (!overRootZone) {
        // 优先：悬停在节点上 → 作为其子节点；其次：两个同级节点之间 → 插入
        targetParentId = hitTest(world, current.nodeId);
        if (targetParentId === null) {
          insertTarget = findInsertTarget(world, current.nodeId);
        }
      }
      setInteraction((prev) =>
        prev.type === 'dragging-node'
          ? { ...prev, targetParentId, insertTarget, overRootZone }
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
      if (current.overRootZone) {
        commitMove(current.nodeId, null);
        return;
      }
      if (current.insertTarget) {
        // 无效插入目标（循环等）不会产生 insertTarget，这里直接提交
        commitMove(current.nodeId, current.insertTarget.parentId, current.insertTarget.order);
        return;
      }
      if (current.targetParentId !== null) {
        commitMove(current.nodeId, current.targetParentId);
        return;
      }
      // 空白区域：直接取消拖动
      return;
    }

    if (current.type === 'panning') {
      setInteraction({ type: 'idle' });
      // 原地点击（未移动）视为点击画布空白处 → 取消选中
      if (!didPanRef.current) {
        onSelect(null);
      }
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
        <button type="button" onClick={locateSelected} disabled={activeSelectedId === null}>
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
        className={`formula-canvas-world${moveAnimating ? ' animating-move' : ''}`}
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
            const isLitEdge =
              parent.node.node.status === 'lit' && item.node.node.status === 'lit';

            return (
              <path
                key={`${parent.node.node.id}-${item.node.node.id}`}
                className={`formula-graph-edge${isLitEdge ? ' active' : ''}`}
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
        <div className="formula-graph-nodes" role="tree" aria-label="国策树节点">
          {layout.map((item) => {
            const row = item.node.node;
            const isLit = row.status === 'lit';
            const isSelected = activeSelectedId === row.id;
            return (
              <button
                key={row.id}
                type="button"
                className={`formula-graph-node${isLit ? ' active' : ' extinguished'}${item.depth === 0 ? ' root' : ''}${isSelected ? ' selected' : ''}${interaction.type === 'dragging-node' && interaction.nodeId === row.id ? ' is-dragging' : ''}${interaction.type === 'dragging-node' && interaction.targetParentId === row.id ? ' is-drop-target' : ''}${flashId === row.id ? ' flash-new' : ''}`}
                style={{ left: item.x, top: item.y, width: item.width, minHeight: item.height }}
                role="treeitem"
                aria-level={item.depth + 1}
                aria-selected={isSelected}
                aria-label={`${row.policy_name}，${isLit ? '已点亮' : '已熄灭'}`}
                title={row.policy_name}
                onPointerDown={(event) => handleNodePointerDown(event, row.id)}
                onClick={() => {
                  if (!didDragRef.current) onSelect(row.id);
                }}
              >
                <span className="formula-graph-node-dot" aria-hidden="true" />
                <span className="formula-graph-node-title">{row.policy_name}</span>
              </button>
            );
          })}
          {interaction.type === 'dragging-node' && dragPointer && (() => {
            const moved = findPolicyNode(roots, interaction.nodeId);
            if (!moved) return null;
            return (
              <div
                className="formula-graph-node-drag-ghost"
                style={{ left: dragPointer.world.x, top: dragPointer.world.y }}
              >
                <span className="formula-graph-node-dot" aria-hidden="true" />
                <span className="formula-graph-node-title">{moved.node.policy_name}</span>
              </div>
            );
          })()}
          {interaction.type === 'dragging-node' && interaction.insertTarget && (
            <div
              className="formula-graph-insert-indicator"
              style={{
                left: interaction.insertTarget.left,
                top: interaction.insertTarget.rowY,
                width: interaction.insertTarget.right - interaction.insertTarget.left,
                transform: 'translateY(-50%)',
              }}
              aria-hidden="true"
            />
          )}
        </div>
      </div>
    </div>
  );
}
