import { ProjectData } from '../types';

interface SaveFileOptions {
  pickerId?: string;
  confirmProjectName?: string;
}

export const generateId = (length: number = 10): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

export const formatDate = (isoString: string): string => {
  return new Date(isoString).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

export const formatCompactDateTime = (isoString?: string | null): string => {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${min}`;
};

export const formatDateForFilename = (date: Date): string => {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}_${hh}${min}`;
};

export const sanitizeFilename = (name: string): string => {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim();
};

export const saveFile = async (
  content: string,
  filename: string,
  contentType: string,
  options: SaveFileOptions = {}
): Promise<boolean> => {
  // Let supporting browsers reopen the last directory used for the same project export id.
  if ('showSaveFilePicker' in window) {
    try {
      const pickerOptions: Record<string, unknown> = {
        suggestedName: filename,
        types: [{
          description: contentType.includes('json') ? 'JSON File' : 'Markdown File',
          accept: { [contentType]: ['.' + filename.split('.').pop()] },
        }],
      };

      if (options.pickerId) {
        pickerOptions.id = options.pickerId;
      }

      const handle = await (window as any).showSaveFilePicker(pickerOptions);
      if (options.confirmProjectName) {
        const confirmed = window.confirm(
          [
            '请确认本次导出信息：',
            '',
            `当前项目名：${options.confirmProjectName}`,
            `即将导出的文件名：${handle.name || filename}`,
            '',
            '确认后将写入所选文件。'
          ].join('\n')
        );

        if (!confirmed) {
          return false;
        }
      }
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return true;
    } catch (err: any) {
      if (err.name === 'AbortError') {
          return false; // User cancelled
      }
      console.error('File save failed:', err);
      // Fallback to legacy download if arbitrary error occurs
    }
  }
  
  // Legacy Fallback
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  return true;
};

export const downloadJson = async (data: object, filename: string, options: SaveFileOptions = {}): Promise<boolean> => {
  return saveFile(JSON.stringify(data, null, 2), filename, 'application/json', options);
};

export const downloadJsonDirect = async (data: object, filename: string): Promise<boolean> => {
  // Force legacy download to skip File System Access API picker
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  return true;
};

export const downloadMarkdown = async (data: ProjectData, filename: string, options: SaveFileOptions = {}): Promise<boolean> => {
  // Use project name as H1
  let md = `# ${data.projectName || 'Flow Export'}\n\n`;
  
  // 1. Outline Overview
  md += `## Outline\n\n`;
  const statusIcons: Record<string, string> = {
      waiting: '○', inProgress: '▶', completed: '✓', onHold: '−'
  };
  
  data.nodes.forEach(node => {
      const indent = '  '.repeat(node.depth);
      md += `${indent}- ${statusIcons[node.status]} **${node.text || 'Untitled'}**\n`;
      if (node.desc) {
          md += `${indent}  *${node.desc}*\n`;
      }
  });

  // 2. Separator
  md += `\n---\n\n`;

  // 3. Global Root Info
  md += `## Global Context (Root)\n\n`;
  const rootContent = data.contentMap['root'];
  if (rootContent) {
      md += `${rootContent}\n`;
  } else {
      md += `(No global context recorded)\n`;
  }

  // 4. Separator
  md += `\n---\n\n`;

  // 5. Node Details
  md += `## Details\n\n`;
  data.nodes.forEach(node => {
      const content = data.contentMap[node.id];
      if (content && content.trim()) {
          md += `\n`;
          md += content; 
          md += `\n\n---\n`;
      }
  });

  return saveFile(md, filename, 'text/markdown', options);
};
