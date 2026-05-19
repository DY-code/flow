import React from 'react';
import { useStore } from '../context/Store';
import { LogNode } from '../types';
import { formatCompactDateTime } from '../utils/helpers';
import { IconTarget } from './Icons';

const INDENT_SIZE = 24;

interface MinimalRow {
  node: LogNode;
  visualDepth: number;
  isCompressedFromParent: boolean;
}

const MinimalOutlineTree: React.FC = () => {
  const { state, dispatch } = useStore();
  const { nodes, activeNodeId, focusedNodeId, ui } = state;

  const getVisibleNodes = () => {
    let filteredNodes: LogNode[] = nodes;

    if (focusedNodeId) {
      const focusedIndex = nodes.findIndex((node) => node.id === focusedNodeId);
      if (focusedIndex !== -1) {
        const focusedNode = nodes[focusedIndex];
        const focusedNodes = [focusedNode];

        for (let i = focusedIndex + 1; i < nodes.length; i += 1) {
          if (nodes[i].depth > focusedNode.depth) focusedNodes.push(nodes[i]);
          else break;
        }

        filteredNodes = focusedNodes;
      }
    }

    if (ui.hideOnHold) {
      const holdFilteredNodes: LogNode[] = [];
      let skipOnHoldSubtreeDepth: number | null = null;

      filteredNodes.forEach((node) => {
        if (skipOnHoldSubtreeDepth !== null) {
          if (node.depth > skipOnHoldSubtreeDepth) return;
          skipOnHoldSubtreeDepth = null;
        }

        if (node.status === 'onHold') {
          skipOnHoldSubtreeDepth = node.depth;
          return;
        }

        holdFilteredNodes.push(node);
      });

      filteredNodes = holdFilteredNodes;
    }

    const visible: LogNode[] = [];
    let skipUntilDepth: number | null = null;

    filteredNodes.forEach((node) => {
      if (skipUntilDepth !== null && node.depth > skipUntilDepth) return;

      visible.push(node);
      skipUntilDepth = node.collapsed ? node.depth : null;
    });

    return visible;
  };

  const visibleNodes = getVisibleNodes();
  const focusedNode = focusedNodeId ? nodes.find((node) => node.id === focusedNodeId) : null;
  const baseDepth = focusedNode ? focusedNode.depth : 0;

  const getVisibleDirectChildCount = (parentNode: LogNode) => {
    const parentIndex = visibleNodes.findIndex((node) => node.id === parentNode.id);
    if (parentIndex === -1) return 0;

    let count = 0;
    for (let i = parentIndex + 1; i < visibleNodes.length; i += 1) {
      if (visibleNodes[i].depth <= parentNode.depth) break;
      if (visibleNodes[i].depth === parentNode.depth + 1) count += 1;
    }

    return count;
  };

  const rows = visibleNodes.reduce<MinimalRow[]>((acc, node, index) => {
    const actualDepth = Math.max(0, node.depth - baseDepth);
    const previousRow = acc[index - 1];
    const previousNode = visibleNodes[index - 1];
    const isDirectChildOfPrevious = !!previousNode && node.depth === previousNode.depth + 1;
    const isCompressedFromParent = getVisibleDirectChildCount(node) <= 1 && isDirectChildOfPrevious && getVisibleDirectChildCount(previousNode) === 1;
    const visualDepth = isCompressedFromParent
      ? previousRow.visualDepth
      : actualDepth;

    acc.push({ node, visualDepth, isCompressedFromParent });
    return acc;
  }, []);

  const shouldDrawVerticalLine = (currentIndex: number, visualDepthToCheck: number) => {
    for (let i = currentIndex + 1; i < rows.length; i += 1) {
      if (rows[i].visualDepth < visualDepthToCheck) return false;
      if (rows[i].visualDepth === visualDepthToCheck) return true;
    }
    return false;
  };

  const getHasChildren = (node: LogNode) => {
    const nodeIndex = nodes.findIndex((item) => item.id === node.id);
    const nextNode = nodes[nodeIndex + 1];
    return !!nextNode && nextNode.depth > node.depth;
  };

  return (
    <div className="flex-1 overflow-y-auto pb-0 bg-white/62 dark:bg-zinc-950/62 backdrop-blur-sm outline-none transition-colors">
      {rows.map((row, index) => {
        const { node, visualDepth, isCompressedFromParent } = row;
        const isActive = activeNodeId === node.id;
        const hasChildren = getHasChildren(node);
        const nodeLastModifiedLabel = formatCompactDateTime(node.lastModified);
        const arrowLeft = 4 + visualDepth * INDENT_SIZE + 12;

        return (
          <div
            key={node.id}
            className="group relative flex min-w-0 items-center border-y border-transparent transition-colors hover:bg-gray-50 dark:hover:bg-zinc-800"
            style={{ height: '36px' }}
            onClick={(event) => {
              if ((event.target as HTMLElement).closest('button')) return;
              dispatch({ type: 'SET_ACTIVE_NODE', payload: node.id });
            }}
          >
            <div
              className="pointer-events-none absolute left-0 top-0 bottom-0 select-none overflow-visible"
              style={{ width: `${(visualDepth + 1) * INDENT_SIZE}px`, paddingLeft: '4px' }}
            >
              {hasChildren && !node.collapsed && (
                <div
                  className="absolute top-0 bottom-0"
                  style={{ left: `${4 + visualDepth * INDENT_SIZE}px`, width: `${INDENT_SIZE}px` }}
                >
                  <div className="absolute left-1/2 top-1/2 bottom-0 w-px -translate-x-1/2 bg-gray-300 dark:bg-zinc-600" />
                </div>
              )}

              {Array.from({ length: visualDepth }).map((_, i) => {
                const isParentLevel = i === visualDepth - 1;
                const hasLine = shouldDrawVerticalLine(index, i + 1);

                return (
                  <div
                    key={i}
                    className="absolute top-0 bottom-0"
                    style={{ left: `${4 + i * INDENT_SIZE}px`, width: `${INDENT_SIZE}px` }}
                  >
                    {isParentLevel && isCompressedFromParent ? (
                      <div className={`absolute left-1/2 w-px -translate-x-1/2 bg-gray-300 dark:bg-zinc-600 ${hasLine ? 'top-0 bottom-0' : 'top-0 h-1/2'}`} />
                    ) : isParentLevel ? (
                      <>
                        <div className={`absolute left-1/2 w-px -translate-x-1/2 bg-gray-300 dark:bg-zinc-600 ${hasLine ? 'top-0 bottom-0' : 'top-0 h-1/2'}`} />
                        <div className="absolute top-1/2 left-1/2 h-px w-6 bg-gray-300 dark:bg-zinc-600" />
                      </>
                    ) : (
                      hasLine && <div className="absolute left-1/2 top-0 bottom-0 w-px -translate-x-1/2 bg-gray-300 dark:bg-zinc-600" />
                    )}
                  </div>
                );
              })}

              {isCompressedFromParent && (
                <svg
                  className="absolute top-[-18px] z-20 h-9 w-4 overflow-visible text-gray-300 dark:text-zinc-600"
                  style={{ left: `${arrowLeft - 8}px` }}
                  viewBox="0 0 16 36"
                  aria-hidden="true"
                >
                  <path
                    d="M8 4V31"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1"
                    strokeLinecap="round"
                  />
                  <path
                    d="M4.5 27.5 8 31l3.5-3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </div>

            <div
              className="z-0 flex min-w-0 flex-1 items-center pr-2"
              style={{ paddingLeft: `${4 + visualDepth * INDENT_SIZE}px` }}
            >
              <button
                type="button"
                className={`relative flex h-6 w-6 shrink-0 items-center justify-center rounded ${hasChildren ? 'cursor-pointer' : 'cursor-default'}`}
                onClick={(event) => {
                  event.stopPropagation();
                  if (hasChildren) dispatch({ type: 'TOGGLE_COLLAPSE', payload: node.id });
                }}
                title={hasChildren ? (node.collapsed ? '展开节点' : '折叠节点') : undefined}
              >
                <div className={`
                  z-10 h-2 w-2 rounded-full border transition-all duration-200
                  ${hasChildren && node.collapsed
                    ? (isActive ? 'border-transparent bg-[color:var(--flow-accent)]' : 'border-transparent bg-gray-500 dark:bg-zinc-400')
                    : (isActive ? 'border-2 border-[color:var(--flow-accent)] bg-white dark:bg-zinc-900' : 'border-gray-400 bg-white dark:border-zinc-500 dark:bg-zinc-900')
                  }
                  ${isActive ? 'scale-110' : ''}
                `} />
              </button>

              <div className="ml-1 flex h-full min-w-0 flex-1 items-center">
                <span className={`
                  truncate text-sm
                  ${isActive ? 'font-bold text-gray-900 dark:text-white' : 'font-medium'}
                  ${!node.text && !isActive ? 'text-gray-400 dark:text-gray-500 italic' : ''}
                  ${node.text && !isActive ? 'text-gray-700 dark:text-gray-200' : ''}
                `}>
                  {node.text || 'Untitled'}
                </span>

                {ui.showOutlineDetails && node.desc && (
                  <span className="ml-3 max-w-[40%] shrink-0 truncate text-xs font-normal text-gray-400 select-none hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-400">
                    {node.desc}
                  </span>
                )}
              </div>

              {ui.showNodeLastModified && nodeLastModifiedLabel && (
                <div className="ml-2 shrink-0">
                  <span className="whitespace-nowrap text-[11px] text-gray-400 dark:text-gray-500" title="节点最近修改时间">
                    {nodeLastModifiedLabel}
                  </span>
                </div>
              )}

              <div className={`ml-2 opacity-0 transition-opacity group-hover:opacity-100 ${focusedNodeId === node.id ? 'opacity-50' : ''}`}>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    dispatch({ type: 'SET_FOCUSED_NODE', payload: node.id === focusedNodeId ? null : node.id });
                  }}
                  className="rounded p-1 text-gray-400 transition-colors hover:text-[color:var(--flow-accent)]"
                  title={node.id === focusedNodeId ? 'Exit Focus' : 'Focus on this node'}
                >
                  <IconTarget className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        );
      })}

      <div className="h-[108px] min-h-[108px]" />
    </div>
  );
};

export default MinimalOutlineTree;
