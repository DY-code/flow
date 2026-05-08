type StoredDirectoryHandle = unknown;

export interface ExportFolderFileEntry {
  name: string;
  handle: unknown;
}

const DB_NAME = 'flow-file-handles';
const DB_VERSION = 2;
const FILE_HANDLE_STORE_NAME = 'exportHandles';
const DIRECTORY_HANDLE_STORE_NAME = 'exportDirectories';

const openFileHandleDb = (): Promise<IDBDatabase | null> => {
  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FILE_HANDLE_STORE_NAME)) {
        db.createObjectStore(FILE_HANDLE_STORE_NAME);
      }
      if (!db.objectStoreNames.contains(DIRECTORY_HANDLE_STORE_NAME)) {
        db.createObjectStore(DIRECTORY_HANDLE_STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const waitForRequest = <T>(request: IDBRequest<T>): Promise<T> => (
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  })
);

const waitForTransaction = (transaction: IDBTransaction): Promise<void> => (
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  })
);

const isDirectoryHandle = (handle: StoredDirectoryHandle | undefined): boolean => {
  return !!handle && typeof handle === 'object' && (handle as { kind?: string }).kind === 'directory';
};

const isFileHandle = (handle: unknown): boolean => {
  return !!handle && typeof handle === 'object' && (handle as { kind?: string }).kind === 'file';
};

export const loadProjectExportDirectoryHandle = async (projectPickerId?: string): Promise<StoredDirectoryHandle | undefined> => {
  if (!projectPickerId) return undefined;

  try {
    const db = await openFileHandleDb();
    if (!db) return undefined;

    try {
      const transaction = db.transaction(DIRECTORY_HANDLE_STORE_NAME, 'readonly');
      const request = transaction.objectStore(DIRECTORY_HANDLE_STORE_NAME).get(projectPickerId);
      const handle = await waitForRequest(request);
      await waitForTransaction(transaction);
      return isDirectoryHandle(handle) ? handle : undefined;
    } finally {
      db.close();
    }
  } catch (error) {
    console.warn('Failed to load project export directory handle:', error);
    return undefined;
  }
};

export const hasProjectExportDirectoryHandle = async (projectPickerId?: string): Promise<boolean> => {
  return !!(await loadProjectExportDirectoryHandle(projectPickerId));
};

export const saveProjectExportDirectoryHandle = async (
  projectPickerId: string | undefined,
  handle: StoredDirectoryHandle
): Promise<void> => {
  if (!projectPickerId || !isDirectoryHandle(handle)) return;

  try {
    const db = await openFileHandleDb();
    if (!db) return;

    try {
      const transaction = db.transaction(DIRECTORY_HANDLE_STORE_NAME, 'readwrite');
      transaction.objectStore(DIRECTORY_HANDLE_STORE_NAME).put(handle, projectPickerId);
      await waitForTransaction(transaction);
    } finally {
      db.close();
    }
  } catch (error) {
    console.warn('Failed to save project export directory handle:', error);
  }
};

export const selectProjectExportDirectory = async (projectPickerId?: string): Promise<boolean> => {
  if (!('showDirectoryPicker' in window)) {
    return false;
  }

  const basePickerOptions: Record<string, unknown> = { mode: 'readwrite' };
  if (projectPickerId) {
    basePickerOptions.id = projectPickerId;
  }

  const currentDirectoryHandle = await loadProjectExportDirectoryHandle(projectPickerId);
  let handle: StoredDirectoryHandle | undefined;

  if (currentDirectoryHandle) {
    try {
      handle = await (window as any).showDirectoryPicker({
        ...basePickerOptions,
        startIn: currentDirectoryHandle,
      });
    } catch (error: any) {
      if (error.name === 'AbortError') return false;
      console.warn('Failed to open directory picker from saved export directory. Falling back:', error);
    }
  }

  if (!handle) {
    try {
      handle = await (window as any).showDirectoryPicker(basePickerOptions);
    } catch (error: any) {
      if (error.name === 'AbortError') return false;
      throw error;
    }
  }

  if (!isDirectoryHandle(handle)) return false;

  await saveProjectExportDirectoryHandle(projectPickerId, handle);
  return true;
};

export const listProjectExportDirectoryFiles = async (
  projectPickerId: string | undefined,
  extension: string
): Promise<ExportFolderFileEntry[] | null> => {
  const directoryHandle = await loadProjectExportDirectoryHandle(projectPickerId);
  if (!directoryHandle) return null;

  const normalizedExtension = extension.toLowerCase().startsWith('.')
    ? extension.toLowerCase()
    : `.${extension.toLowerCase()}`;
  const files: ExportFolderFileEntry[] = [];

  for await (const handle of (directoryHandle as any).values()) {
    if (isFileHandle(handle) && handle.name.toLowerCase().endsWith(normalizedExtension)) {
      files.push({ name: handle.name, handle });
    }
  }

  return files.sort((a, b) => a.name.localeCompare(b.name));
};

export const writeFileHandle = async (handle: unknown, content: string): Promise<void> => {
  if (!isFileHandle(handle)) {
    throw new Error('目标不是有效文件。');
  }

  const writable = await (handle as any).createWritable();
  await writable.write(content);
  await writable.close();
};
