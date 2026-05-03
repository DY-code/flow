import { ProjectData } from '../types';

interface SaveFileOptions {
  pickerId?: string;
}

interface OverwriteFileOptions {
  description: string;
  extensions: string[];
  validateTargetName?: (filename: string) => boolean | Promise<boolean>;
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

const decodeText = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  const invalidEncodingMessage = '文件编码不是有效 UTF-8。请先转换为 UTF-8 后再打开或导入。';

  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(3));
  }

  if (bytes.length >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      return new TextDecoder('utf-16le', { fatal: true }).decode(bytes.subarray(2));
    }
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      return new TextDecoder('utf-16be', { fatal: true }).decode(bytes.subarray(2));
    }
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new Error(invalidEncodingMessage);
  }
};

export const readTextFile = async (file: File): Promise<string> => {
  const buffer = await file.arrayBuffer();
  return decodeText(buffer);
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

export const overwriteFile = async (
  content: string,
  contentType: string,
  options: OverwriteFileOptions
): Promise<boolean> => {
  if (!('showOpenFilePicker' in window)) {
    throw new Error('当前浏览器不支持安全覆盖，请使用 Export 导出或覆盖文件。');
  }

  try {
    const [handle] = await (window as any).showOpenFilePicker({
      multiple: false,
      types: [{
        description: options.description,
        accept: { [contentType]: options.extensions },
      }],
    });

    if (!handle) return false;

    if (options.validateTargetName) {
      const canSave = await options.validateTargetName(handle.name);
      if (!canSave) return false;
    }

    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
    return true;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return false;
    }
    console.error('File overwrite failed:', err);
    throw err;
  }
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

export const buildMarkdownExport = (data: ProjectData): string => {
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

  return md;
};

export const downloadMarkdown = async (data: ProjectData, filename: string, options: SaveFileOptions = {}): Promise<boolean> => {
  return saveFile(buildMarkdownExport(data), filename, 'text/markdown', options);
};
