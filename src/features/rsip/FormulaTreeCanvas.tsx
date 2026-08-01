import { useEffect, useMemo, useRef, useState } from 'react';
import {
  findFormulaPath,
  getContentBounds,
  layoutForest,
  type FormulaTreeNode,
  type LayoutNode,
} from './formulaTreeLayout';
import { fitTransform, zoomAtCursor, type CanvasTransform } from './formulaTreeGeometry';

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
}: {
  roots: FormulaTreeNode[];
  selectedFormulaId: number | null;
  highlightId?: number | null;
  onSelect: (id: number) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const wheelRequestRef = useRef<{ cursorX: number; cursorY: number; deltaY: number } | null>(null);
  const didFitRef = useRef(false);
  const lastHandledHighlightRef = useRef<number | null>(null);

  const [transform, setTransform] = useState<CanvasTransform>({ panX: 0, panY: 0, scale: 1 });
  const [interaction, setInteraction] = useState<InteractionState>({ type: 'idle' });

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

  function handleViewportPointerDown(event: React.PointerEvent) {
    if ((event.target as HTMLElement).closest('.formula-graph-node')) return;
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
    }
  }

  function handleViewportPointerUp(event: React.PointerEvent) {
    const current = interaction;
    if (current.type === 'idle' || event.pointerId !== current.pointerId) return;
    const viewport = viewportRef.current;
    if (viewport && viewport.hasPointerCapture(event.pointerId)) {
      viewport.releasePointerCapture(event.pointerId);
    }
    setInteraction({ type: 'idle' });
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
        </svg>
        <div className="formula-graph-nodes" role="tree" aria-label="国策树习惯节点">
          {layout.map((item) => {
            const isSelected = selectedFormulaId === item.node.id;
            return (
              <button
                key={item.node.id}
                type="button"
                className={`formula-graph-node${item.node.status === 'active' ? ' active' : ''}${item.depth === 0 ? ' root' : ''}${isSelected ? ' selected' : ''}`}
                style={{ left: item.x, top: item.y, width: item.width, minHeight: item.height }}
                role="treeitem"
                aria-level={item.depth + 1}
                aria-selected={isSelected}
                aria-label={`${item.node.title}，${item.node.status === 'active' ? '已点亮' : '未点亮'}`}
                title={item.node.title}
                onClick={() => onSelect(item.node.id)}
              >
                <span className="formula-graph-node-dot" aria-hidden="true" />
                <span className="formula-graph-node-title">{item.node.title}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
