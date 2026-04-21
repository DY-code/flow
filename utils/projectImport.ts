import { ContentMap, LogNode, ProjectData } from '../types';
import { generateId } from './helpers';

const findSubtreeEndIndex = (nodes: LogNode[], startIndex: number): number => {
  const startDepth = nodes[startIndex]?.depth;
  let endIndex = startIndex + 1;

  while (endIndex < nodes.length && nodes[endIndex].depth > startDepth) {
    endIndex += 1;
  }

  return endIndex;
};

const generateUniqueNodeId = (usedIds: Set<string>): string => {
  let id = generateId();
  while (usedIds.has(id)) {
    id = generateId();
  }
  usedIds.add(id);
  return id;
};

export const countNodeDescendants = (nodes: LogNode[], nodeId: string): number => {
  const index = nodes.findIndex((node) => node.id === nodeId);
  if (index === -1) return 0;
  return findSubtreeEndIndex(nodes, index) - index - 1;
};

export const cloneSubtreeIntoProject = ({
  sourceProject,
  targetProject,
  sourceNodeId,
  nowIso = new Date().toISOString()
}: {
  sourceProject: ProjectData;
  targetProject: ProjectData;
  sourceNodeId: string;
  nowIso?: string;
}): ProjectData => {
  const startIndex = sourceProject.nodes.findIndex((node) => node.id === sourceNodeId);
  if (startIndex === -1) {
    throw new Error('未找到要导入的源节点');
  }

  const endIndex = findSubtreeEndIndex(sourceProject.nodes, startIndex);
  const sourceSubtree = sourceProject.nodes.slice(startIndex, endIndex);
  const rootDepth = sourceSubtree[0].depth;
  const usedIds = new Set(targetProject.nodes.map((node) => node.id));
  const clonedContentMap: ContentMap = {};

  const clonedNodes = sourceSubtree.map((node) => {
    const clonedId = generateUniqueNodeId(usedIds);
    const { id, depth, order, sourceNodeId: _sourceNodeId, ...rest } = node;
    clonedContentMap[clonedId] = sourceProject.contentMap[id] || '';

    return {
      ...rest,
      id: clonedId,
      depth: Math.max(0, depth - rootDepth),
      order: 0
    };
  });

  const nextNodes = [...targetProject.nodes, ...clonedNodes]
    .map((node, index) => ({ ...node, order: index }));

  return {
    ...targetProject,
    nodes: nextNodes,
    contentMap: {
      ...targetProject.contentMap,
      ...clonedContentMap,
      root: targetProject.contentMap.root || ''
    },
    activeNodeId: clonedNodes[0]?.id || targetProject.activeNodeId || targetProject.nodes[0]?.id || null,
    metadata: {
      ...targetProject.metadata,
      lastModified: nowIso
    }
  };
};
