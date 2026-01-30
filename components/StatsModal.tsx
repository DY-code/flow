import React from 'react';
import { useStore } from '../context/Store';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

const COLORS = {
  waiting: '#9CA3AF',    // gray-400
  inProgress: '#3B82F6', // blue-500
  completed: '#22C55E',  // green-500
  onHold: '#F97316'      // orange-500
};

const StatsModal: React.FC = () => {
  const { state, dispatch } = useStore();
  const { nodes, ui } = state;

  if (!ui.showStats) return null;

  const data = [
    { name: 'Waiting', value: nodes.filter(n => n.status === 'waiting').length, fill: COLORS.waiting },
    { name: 'In Progress', value: nodes.filter(n => n.status === 'inProgress').length, fill: COLORS.inProgress },
    { name: 'Completed', value: nodes.filter(n => n.status === 'completed').length, fill: COLORS.completed },
    { name: 'On Hold', value: nodes.filter(n => n.status === 'onHold').length, fill: COLORS.onHold },
  ].filter(d => d.value > 0);

  const total = nodes.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl p-6 w-full max-w-lg border border-transparent dark:border-zinc-800">
        <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-gray-800 dark:text-white">Project Statistics</h2>
            <button 
                onClick={() => dispatch({ type: 'TOGGLE_STATS', payload: false })}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
                ✕
            </button>
        </div>

        <div className="h-64 w-full">
            {total > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                    <Pie
                        data={data}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                    >
                        {data.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} stroke="none" />
                        ))}
                    </Pie>
                    <Tooltip 
                        contentStyle={{ 
                            backgroundColor: 'var(--color-bg-subtle)', 
                            borderColor: 'var(--color-border)',
                            color: 'var(--color-fg-default)' 
                        }} 
                    />
                    <Legend />
                    </PieChart>
                </ResponsiveContainer>
            ) : (
                <div className="h-full flex items-center justify-center text-gray-400 dark:text-zinc-600">
                    No tasks found.
                </div>
            )}
        </div>

        <div className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
            Total Tasks: <span className="font-semibold text-gray-900 dark:text-white">{total}</span>
        </div>
      </div>
    </div>
  );
};

export default StatsModal;