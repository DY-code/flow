import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../context/Store';
import { LogNode, NodeStatus } from '../types';
import { formatCompactDateTime } from '../utils/helpers';
import { IconMinus, IconPlus, IconX } from './Icons';

interface MindFlowWindowProps {
  isOpen: boolean;
  onClose: () => void;
}

interface FlowTreeItem {
  id: string;
  text: string;
  desc: string;
  status?: NodeStatus;
  lastModified: string;
  depth: number;
  isProjectRoot?: boolean;
  nodeCount?: number;
}

interface TreeNode {
  item: FlowTreeItem;
  children: TreeNode[];
}

interface FlowNodeLayout {
  item: FlowTreeItem;
  x: number;
  y: number;
  canToggle: boolean;
  isExpanded: boolean;
  hiddenChildCount: number;
}

interface FlowEdge {
  from: Point;
  to: Point;
}

interface Point {
  x: number;
  y: number;
}

const NODE_WIDTH = 176;
const NODE_HEIGHT = 46;
const PROGRESS_GAP_X = 230;
const SIBLING_GAP_Y = 30;
const CANVAS_PADDING = 96;
const MIN_WINDOW_WIDTH = 520;
const MIN_WINDOW_HEIGHT = 420;
const MIN_ZOOM = 0.45;
const MAX_ZOOM = 1.9;
const PROJECT_ROOT_ID = '__project_root__';

const STATUS_LABELS: Record<NodeStatus, string> = {
  waiting: '待进行',
  inProgress: '进行中',
  completed: '已完成',
  onHold: '暂时搁置'
};

const STATUS_DOT_CLASS: Record<NodeStatus, string> = {
  waiting: 'bg-gray-300 dark:bg-zinc-500',
  inProgress: 'bg-[color:var(--flow-accent)]',
  completed: 'bg-green-500',
  onHold: 'bg-amber-500'
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const getInitialWindowSize = () => {
  if (typeof window === 'undefined') return { width: 960, height: 620 };

  const maxWidth = Math.max(320, window.innerWidth - 32);
  const maxHeight = Math.max(320, window.innerHeight - 32);
  const minWidth = Math.min(MIN_WINDOW_WIDTH, maxWidth);
  const minHeight = Math.min(MIN_WINDOW_HEIGHT, maxHeight);

  return {
    width: clamp(Math.min(window.innerWidth * 0.8, 1120), minWidth, maxWidth),
    height: clamp(window.innerHeight * 0.7, minHeight, maxHeight)
  };
};

const getInitialWindowPosition = (size = getInitialWindowSize()) => {
  if (typeof window === 'undefined') return { x: 120, y: 80 };

  return {
    x: Math.max(16, (window.innerWidth - size.width) / 2),
    y: Math.max(16, (window.innerHeight - size.height) / 2)
  };
};

const buildTree = (nodes: LogNode[]): TreeNode[] => {
  const roots: TreeNode[] = [];
  const stack: TreeNode[] = [];

  nodes.forEach((node) => {
    const treeNode: TreeNode = {
      item: {
        id: node.id,
        text: node.text,
        desc: node.desc,
        status: node.status,
        lastModified: node.lastModified,
        depth: node.depth
      },
      children: []
    };

    while (stack.length && stack[stack.length - 1].item.depth >= node.depth) {
      stack.pop();
    }

    const parent = stack[stack.length - 1];
    if (parent) {
      parent.children.push(treeNode);
    } else {
      roots.push(treeNode);
    }

    stack.push(treeNode);
  });

  return roots;
};

const getRootNodeIds = (nodes: LogNode[]) => nodes.filter((node) => node.depth === 0).map((node) => node.id);

const buildMindFlowLayout = (
  nodes: LogNode[],
  expandedNodeIds: Set<string>,
  projectName: string,
  projectLastModified: string
) => {
  const roots: TreeNode[] = [{
    item: {
      id: PROJECT_ROOT_ID,
      text: projectName || 'Untitled Project',
      desc: `${nodes.length} 个节点`,
      lastModified: projectLastModified,
      depth: -1,
      isProjectRoot: true,
      nodeCount: nodes.length
    },
    children: buildTree(nodes)
  }];
  const rawNodes = new Map<string, FlowNodeLayout>();
  const rawEdges: FlowEdge[] = [];

  const getVisibleChildren = (item: TreeNode) => (
    expandedNodeIds.has(item.item.id) ? item.children : []
  );

  const getSubtreeHeight = (item: TreeNode): number => {
    const children = getVisibleChildren(item);
    if (!children.length) return NODE_HEIGHT;
    return Math.max(NODE_HEIGHT, getSiblingGroupHeight(children));
  };

  const getSiblingGroupHeight = (items: TreeNode[]): number => {
    if (!items.length) return 0;

    return items.reduce((height, item, index) => {
      return height + getSubtreeHeight(item) + (index > 0 ? SIBLING_GAP_Y : 0);
    }, 0);
  };

  const placeSiblingGroup = (items: TreeNode[], startX: number, topY: number, anchor: Point) => {
    let cursorY = topY;

    items.forEach((item, index) => {
      if (index > 0) cursorY += SIBLING_GAP_Y;

      const rootPoint = placeNodeSubtree(item, startX, cursorY);
      rawEdges.push({
        from: anchor,
        to: rootPoint
      });

      cursorY += getSubtreeHeight(item);
    });
  };

  const placeRootGroup = (items: TreeNode[], startX: number, topY: number) => {
    let cursorY = topY;

    items.forEach((item, index) => {
      if (index > 0) cursorY += SIBLING_GAP_Y;
      placeNodeSubtree(item, startX, cursorY);
      cursorY += getSubtreeHeight(item);
    });
  };

  const placeNodeSubtree = (item: TreeNode, x: number, topY: number): Point => {
    const children = getVisibleChildren(item);
    const childGroupHeight = getSiblingGroupHeight(children);
    const subtreeHeight = getSubtreeHeight(item);
    const y = children.length
      ? topY + Math.max(NODE_HEIGHT, childGroupHeight) / 2 - NODE_HEIGHT / 2
      : topY;

    rawNodes.set(item.item.id, {
      item: item.item,
      x,
      y,
      canToggle: item.children.length > 0,
      isExpanded: expandedNodeIds.has(item.item.id),
      hiddenChildCount: expandedNodeIds.has(item.item.id) ? 0 : item.children.length
    });

    if (children.length) {
      placeSiblingGroup(
        children,
        x + PROGRESS_GAP_X,
        topY + Math.max(0, (subtreeHeight - childGroupHeight) / 2),
        { x: x + NODE_WIDTH, y: y + NODE_HEIGHT / 2 }
      );
    }

    return { x, y: y + NODE_HEIGHT / 2 };
  };

  placeRootGroup(roots, 0, 0);

  const allX = [
    ...Array.from(rawNodes.values()).flatMap((item) => [item.x, item.x + NODE_WIDTH]),
    ...rawEdges.flatMap((edge) => [edge.from.x, edge.to.x])
  ];
  const allY = [
    ...Array.from(rawNodes.values()).flatMap((item) => [item.y, item.y + NODE_HEIGHT]),
    ...rawEdges.flatMap((edge) => [edge.from.y, edge.to.y])
  ];

  const minX = Math.min(...allX, 0);
  const maxX = Math.max(...allX, NODE_WIDTH);
  const minY = Math.min(...allY, 0);
  const maxY = Math.max(...allY, NODE_HEIGHT);
  const offsetX = CANVAS_PADDING - minX;
  const offsetY = CANVAS_PADDING - minY;

  return {
    nodes: Array.from(rawNodes.values()).map((item) => ({
      ...item,
      x: item.x + offsetX,
      y: item.y + offsetY
    })),
    edges: rawEdges.map((edge) => ({
      ...edge,
      from: { x: edge.from.x + offsetX, y: edge.from.y + offsetY },
      to: { x: edge.to.x + offsetX, y: edge.to.y + offsetY }
    })),
    width: maxX - minX + CANVAS_PADDING * 2,
    height: maxY - minY + CANVAS_PADDING * 2
  };
};

const buildPath = (from: Point, to: Point) => {
  const delta = Math.max(72, Math.abs(to.x - from.x) * 0.46);
  return `M ${from.x} ${from.y} C ${from.x + delta} ${from.y}, ${to.x - delta} ${to.y}, ${to.x} ${to.y}`;
};

const MindFlowWindow: React.FC<MindFlowWindowProps> = ({ isOpen, onClose }) => {
  const { state } = useStore();
  const windowRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ pointerX: number; pointerY: number; x: number; y: number } | null>(null);
  const resizeStartRef = useRef<{ pointerX: number; pointerY: number; width: number; height: number } | null>(null);
  const panStartRef = useRef<{ pointerX: number; pointerY: number; x: number; y: number } | null>(null);
  const defaultViewPendingRef = useRef(false);
  const [windowSize, setWindowSize] = useState(getInitialWindowSize);
  const [windowPosition, setWindowPosition] = useState(() => getInitialWindowPosition(getInitialWindowSize()));
  const [pan, setPan] = useState({ x: 92, y: 92 });
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(() => new Set());
  const [hoveredDetail, setHoveredDetail] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const layout = useMemo(
    () => buildMindFlowLayout(state.nodes, expandedNodeIds, state.projectName, state.metadata.lastModified),
    [state.nodes, expandedNodeIds, state.projectName, state.metadata.lastModified]
  );
  const hoveredItem = hoveredDetail
    ? layout.nodes.find((item) => item.item.id === hoveredDetail.nodeId)?.item || null
    : null;

  const applyDefaultView = () => {
    const rect = viewportRef.current?.getBoundingClientRect();
    const viewportWidth = rect?.width || 720;
    const viewportHeight = rect?.height || 420;
    const firstNode = layout.nodes[0];

    if (!firstNode) {
      setZoom(1);
      setPan({ x: 92, y: 92 });
      return;
    }

    setZoom(1);
    setPan({
      x: Math.min(112, Math.max(48, viewportWidth * 0.12)) - firstNode.x,
      y: viewportHeight * 0.45 - (firstNode.y + NODE_HEIGHT / 2)
    });
  };

  useEffect(() => {
    if (!isOpen) return;

    const size = getInitialWindowSize();
    setWindowSize(size);
    setWindowPosition(getInitialWindowPosition(size));
    setExpandedNodeIds(new Set([PROJECT_ROOT_ID, ...getRootNodeIds(state.nodes)]));
    setHoveredDetail(null);
    defaultViewPendingRef.current = true;
  }, [isOpen, state.nodes]);

  useEffect(() => {
    if (!isOpen || !defaultViewPendingRef.current) return;

    const frameId = window.requestAnimationFrame(() => {
      applyDefaultView();
      defaultViewPendingRef.current = false;
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [isOpen, layout.width, layout.height, state.nodes.length]);

  if (!isOpen) return null;

  const moveWindow = (event: PointerEvent) => {
    if (!dragStartRef.current) return;
    const nextX = dragStartRef.current.x + event.clientX - dragStartRef.current.pointerX;
    const nextY = dragStartRef.current.y + event.clientY - dragStartRef.current.pointerY;
    const rect = windowRef.current?.getBoundingClientRect();
    const width = rect?.width || 720;
    const height = rect?.height || 480;

    setWindowPosition({
      x: clamp(nextX, 8, Math.max(8, window.innerWidth - width - 8)),
      y: clamp(nextY, 8, Math.max(8, window.innerHeight - height - 8))
    });
  };

  const stopWindowDrag = () => {
    dragStartRef.current = null;
    window.removeEventListener('pointermove', moveWindow);
    window.removeEventListener('pointerup', stopWindowDrag);
  };

  const handleWindowDragStart = (event: React.PointerEvent) => {
    if ((event.target as HTMLElement).closest('button')) return;
    dragStartRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      x: windowPosition.x,
      y: windowPosition.y
    };
    window.addEventListener('pointermove', moveWindow);
    window.addEventListener('pointerup', stopWindowDrag);
  };

  const resizeWindow = (event: PointerEvent) => {
    if (!resizeStartRef.current) return;

    const maxWidth = Math.max(320, window.innerWidth - windowPosition.x - 8);
    const maxHeight = Math.max(320, window.innerHeight - windowPosition.y - 8);
    const minWidth = Math.min(MIN_WINDOW_WIDTH, maxWidth);
    const minHeight = Math.min(MIN_WINDOW_HEIGHT, maxHeight);

    setWindowSize({
      width: clamp(
        resizeStartRef.current.width + event.clientX - resizeStartRef.current.pointerX,
        minWidth,
        maxWidth
      ),
      height: clamp(
        resizeStartRef.current.height + event.clientY - resizeStartRef.current.pointerY,
        minHeight,
        maxHeight
      )
    });
  };

  const stopWindowResize = () => {
    resizeStartRef.current = null;
    window.removeEventListener('pointermove', resizeWindow);
    window.removeEventListener('pointerup', stopWindowResize);
  };

  const handleWindowResizeStart = (event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    resizeStartRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      width: windowSize.width,
      height: windowSize.height
    };
    window.addEventListener('pointermove', resizeWindow);
    window.addEventListener('pointerup', stopWindowResize);
  };

  const moveCanvas = (event: PointerEvent) => {
    if (!panStartRef.current) return;
    setPan({
      x: panStartRef.current.x + event.clientX - panStartRef.current.pointerX,
      y: panStartRef.current.y + event.clientY - panStartRef.current.pointerY
    });
  };

  const stopCanvasPan = () => {
    setIsPanning(false);
    panStartRef.current = null;
    window.removeEventListener('pointermove', moveCanvas);
    window.removeEventListener('pointerup', stopCanvasPan);
  };

  const handleCanvasPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('.mind-flow-node, .mind-flow-detail')) return;
    panStartRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      x: pan.x,
      y: pan.y
    };
    setIsPanning(true);
    setHoveredDetail(null);
    window.addEventListener('pointermove', moveCanvas);
    window.addEventListener('pointerup', stopCanvasPan);
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;

    const nextZoom = clamp(zoom * (event.deltaY > 0 ? 0.9 : 1.1), MIN_ZOOM, MAX_ZOOM);
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const ratio = nextZoom / zoom;

    setZoom(nextZoom);
    setPan({
      x: pointerX - (pointerX - pan.x) * ratio,
      y: pointerY - (pointerY - pan.y) * ratio
    });
  };

  const handleZoomButton = (nextZoom: number) => {
    const normalizedZoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
    setZoom(normalizedZoom);
  };

  const handleResetView = () => {
    setHoveredDetail(null);
    applyDefaultView();
  };

  const toggleNodeExpansion = (item: FlowNodeLayout) => {
    if (!item.canToggle) return;

    setExpandedNodeIds((current) => {
      const next = new Set(current);
      if (next.has(item.item.id)) next.delete(item.item.id);
      else next.add(item.item.id);
      return next;
    });
  };

  const handleNodeClick = (event: React.MouseEvent, item: FlowNodeLayout) => {
    event.stopPropagation();
    toggleNodeExpansion(item);
  };

  const updateHoveredDetail = (event: React.MouseEvent, item: FlowTreeItem) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;

    setHoveredDetail({
      nodeId: item.id,
      x: clamp(event.clientX - rect.left + 12, 16, Math.max(16, rect.width - 280)),
      y: clamp(event.clientY - rect.top + 12, 16, Math.max(16, rect.height - 178))
    });
  };

  return (
    <div
      ref={windowRef}
      className="fixed z-[80] flex min-h-[min(420px,calc(100vh-32px))] min-w-[min(520px,calc(100vw-32px))] flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-950"
      style={{
        left: windowPosition.x,
        top: windowPosition.y,
        width: windowSize.width,
        height: windowSize.height
      }}
    >
      <div
        className="flex h-10 cursor-move items-center justify-between border-b border-gray-200 bg-gray-50 px-3 dark:border-zinc-800 dark:bg-zinc-900"
        onPointerDown={handleWindowDragStart}
      >
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-gray-800 dark:text-gray-100">思维流视图</div>
          <div className="text-[11px] text-gray-500 dark:text-gray-400">父子向右递进，同级纵向并列</div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => handleZoomButton(zoom - 0.12)}
            className="rounded p-1 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-zinc-800 dark:hover:text-gray-100"
            title="缩小"
          >
            <IconMinus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => handleZoomButton(zoom + 0.12)}
            className="rounded p-1 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-zinc-800 dark:hover:text-gray-100"
            title="放大"
          >
            <IconPlus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleResetView}
            className="rounded px-2 py-1 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-zinc-800 dark:hover:text-gray-100"
            title="重置视图"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-zinc-800 dark:hover:text-gray-100"
            title="关闭"
          >
            <IconX className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div
        ref={viewportRef}
        className={`relative flex-1 overflow-hidden bg-slate-50 dark:bg-zinc-950 ${isPanning ? 'cursor-grabbing' : 'cursor-grab'}`}
        onPointerDown={handleCanvasPointerDown}
        onWheel={handleWheel}
      >
        {state.nodes.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-500 dark:text-gray-400">
            当前项目暂无节点。
          </div>
        ) : (
          <div
            className="absolute left-0 top-0"
            style={{
              width: layout.width,
              height: layout.height,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: '0 0'
            }}
          >
            <svg
              className="pointer-events-none absolute left-0 top-0 overflow-visible"
              width={layout.width}
              height={layout.height}
              viewBox={`0 0 ${layout.width} ${layout.height}`}
            >
              {layout.edges.map((edge, index) => (
                <path
                  key={`progress-${index}`}
                  d={buildPath(edge.from, edge.to)}
                  fill="none"
                  stroke="rgba(107, 114, 128, 0.46)"
                  strokeWidth={2.4}
                  strokeLinecap="round"
                />
              ))}
            </svg>

            {layout.nodes.map((item) => {
              const isHovered = hoveredDetail?.nodeId === item.item.id;
              return (
                <button
                  key={item.item.id}
                  type="button"
                  className={`mind-flow-node absolute flex items-center rounded-md border px-3 text-left text-sm font-medium shadow-sm transition-colors ${
                    item.item.isProjectRoot
                      ? 'border-[color:var(--flow-accent-border)] bg-[color:var(--flow-accent-soft)] text-gray-900 shadow-md dark:bg-zinc-900 dark:text-gray-100'
                      : item.item.depth === 0
                      ? 'border-[color:var(--flow-accent-border)] bg-white text-gray-900 shadow-md dark:bg-zinc-900 dark:text-gray-100'
                      : 'border-gray-200 bg-white/95 text-gray-700 dark:border-zinc-700 dark:bg-zinc-900/95 dark:text-gray-200'
                  } ${isHovered ? 'ring-2 ring-[color:var(--flow-accent-border)]' : 'hover:border-[color:var(--flow-accent-border)]'} ${item.canToggle ? 'cursor-pointer' : 'cursor-default'}`}
                  style={{
                    left: item.x,
                    top: item.y,
                    width: NODE_WIDTH,
                    height: NODE_HEIGHT
                  }}
                  onClick={(event) => handleNodeClick(event, item)}
                  onMouseEnter={(event) => updateHoveredDetail(event, item.item)}
                  onMouseMove={(event) => updateHoveredDetail(event, item.item)}
                  onMouseLeave={() => setHoveredDetail(null)}
                  title={item.item.text || 'Untitled'}
                >
                  <span
                    className={`mr-2 h-2.5 w-2.5 shrink-0 rounded-full ${
                      item.item.isProjectRoot ? 'bg-[color:var(--flow-accent)]' : STATUS_DOT_CLASS[item.item.status || 'waiting']
                    }`}
                  />
                  <span className="min-w-0 flex-1 truncate">{item.item.text || 'Untitled'}</span>
                  {item.canToggle && (
                    <span
                      className={`ml-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                        item.isExpanded
                          ? 'text-[color:var(--flow-accent)]'
                          : 'text-gray-400 dark:text-zinc-500'
                      }`}
                      title={item.isExpanded ? '收起' : `展开 ${item.hiddenChildCount || ''}`}
                    >
                      {item.isExpanded ? <IconMinus className="h-3.5 w-3.5" /> : <IconPlus className="h-3.5 w-3.5" />}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {hoveredItem && hoveredDetail && (
          <div
            className="mind-flow-detail absolute z-20 w-64 rounded-lg border border-gray-200 bg-white p-3 text-sm shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
            style={{ left: hoveredDetail.x, top: hoveredDetail.y }}
          >
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-semibold text-gray-900 dark:text-gray-100">
                  {hoveredItem.text || 'Untitled'}
                </div>
                <div className="mt-0.5 text-[11px] text-gray-400 dark:text-zinc-500">
                  最近修改：{formatCompactDateTime(hoveredItem.lastModified) || '未知'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setHoveredDetail(null)}
                className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-zinc-800 dark:hover:text-gray-200"
                title="关闭详情"
              >
                <IconX className="h-3.5 w-3.5" />
              </button>
            </div>
            {hoveredItem.isProjectRoot ? (
              <div className="mb-2 text-xs text-gray-600 dark:text-gray-300">
                节点数量：{hoveredItem.nodeCount || 0}
              </div>
            ) : (
              <div className="mb-2 flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                <span className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT_CLASS[hoveredItem.status || 'waiting']}`} />
                <span>{STATUS_LABELS[hoveredItem.status || 'waiting']}</span>
              </div>
            )}
            <div className="max-h-24 overflow-y-auto rounded-md bg-gray-50 px-2 py-1.5 text-xs leading-5 text-gray-600 dark:bg-zinc-950 dark:text-gray-300">
              {hoveredItem.desc || '暂无摘要'}
            </div>
          </div>
        )}

        <div
          className="absolute bottom-0 right-0 z-30 h-5 w-5 cursor-nwse-resize"
          onPointerDown={handleWindowResizeStart}
          title="拖动调整窗口大小"
        >
          <div className="absolute bottom-1 right-1 h-3 w-3 rounded-sm border-b-2 border-r-2 border-gray-400 dark:border-zinc-500" />
        </div>
      </div>
    </div>
  );
};

export default MindFlowWindow;
