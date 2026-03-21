import React, { useRef, useEffect } from 'react';
import { NodeStatus } from '../types';
import { IconSquare, IconPlay, IconCheck, IconMinus } from './Icons';

interface Props {
  currentStatus: NodeStatus;
  onChange: (status: NodeStatus) => void;
  isOpen: boolean;
  onToggle: () => void;
  showLabel?: boolean; // New prop to control text display on the trigger
}

const StatusMenu: React.FC<Props> = ({ currentStatus, onChange, isOpen, onToggle, showLabel = false }) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onToggle(); // Close on click outside
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onToggle]);

  const getIcon = (status: NodeStatus, className: string = "w-4 h-4") => {
    switch (status) {
      case 'waiting': return <IconSquare className={`${className} text-gray-400 dark:text-zinc-500`} />;
      case 'inProgress': return <IconPlay className={`${className} text-[color:var(--flow-accent)]`} />;
      case 'completed': return <IconCheck className={`${className} text-green-500`} />;
      case 'onHold': return <IconMinus className={`${className} text-amber-500`} />;
    }
  };

  const getLabel = (status: NodeStatus) => {
      switch (status) {
          case 'inProgress': return 'In Progress';
          default: return status.charAt(0).toUpperCase() + status.slice(1);
      }
  };

  return (
    <div className="relative inline-flex items-center" ref={menuRef}>
      <button 
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        className={`flex items-center gap-1.5 p-1 hover:bg-gray-200 dark:hover:bg-zinc-700 rounded transition-colors ${showLabel ? 'pr-2' : ''}`}
        title="Change Status"
      >
        {getIcon(currentStatus)}
        {showLabel && (
            <span className="text-sm font-medium text-gray-600 dark:text-gray-300 select-none">
                {getLabel(currentStatus)}
            </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 z-50 w-32 mt-1 bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded shadow-lg py-1">
          {(['waiting', 'inProgress', 'completed', 'onHold'] as NodeStatus[]).map((status) => (
            <button
              key={status}
              className="flex items-center w-full px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-zinc-700 text-left gap-2"
              onClick={(e) => {
                e.stopPropagation();
                onChange(status);
                onToggle(); // Close on select
              }}
            >
              {getIcon(status)}
              <span className="capitalize text-gray-700 dark:text-gray-200">{getLabel(status)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default StatusMenu;
