import React, { useRef, useState, useEffect } from 'react';

interface SplitPaneProps {
  split: 'vertical' | 'horizontal';
  children: [React.ReactNode, React.ReactNode];
  initialSize?: string; // percentage (e.g., "50%")
}

const SplitPane: React.FC<SplitPaneProps> = ({ split, children, initialSize = '50%' }) => {
  const [size, setSize] = useState<string>(initialSize);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = split === 'vertical' ? 'col-resize' : 'row-resize';
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging.current || !containerRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    let newSize = 0;

    if (split === 'vertical') {
      const offsetX = e.clientX - rect.left;
      newSize = (offsetX / rect.width) * 100;
    } else {
      const offsetY = e.clientY - rect.top;
      newSize = (offsetY / rect.height) * 100;
    }

    // Constraints
    if (newSize < 15) newSize = 15;
    if (newSize > 85) newSize = 85;

    setSize(`${newSize}%`);
  };

  const handleMouseUp = () => {
    isDragging.current = false;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'default';
  };

  return (
    <div 
        ref={containerRef} 
        className={`flex w-full h-full ${split === 'vertical' ? 'flex-row' : 'flex-col'}`}
    >
      <div style={{ 
          [split === 'vertical' ? 'width' : 'height']: size,
          flexShrink: 0 
        }} className="relative overflow-hidden">
        {children[0]}
      </div>

      <div 
        className={`z-10 bg-gray-200 dark:bg-zinc-700 hover:bg-blue-400 dark:hover:bg-blue-600 transition-colors flex items-center justify-center
            ${split === 'vertical' ? 'w-1 cursor-col-resize h-full' : 'h-1 cursor-row-resize w-full'}
        `}
        onMouseDown={handleMouseDown}
      >
          {/* Handle Grip Visual */}
          <div className={`bg-gray-400 dark:bg-zinc-500 rounded-full ${split === 'vertical' ? 'w-0.5 h-6' : 'h-0.5 w-6'}`} />
      </div>

      <div className="flex-1 overflow-hidden">
        {children[1]}
      </div>
    </div>
  );
};

export default SplitPane;