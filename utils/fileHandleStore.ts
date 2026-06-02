type StoredDirectoryHandle = unknown;

export interface ExportFolderFileEntry {
  name: string;
  handle: unknown;
}

export interface RecentImportedProjectEntry {
  id: string;
  fileName: string;
  projectName: string;
  importedAt: string;
  handle: unknown;
}

const DB_NAME = 'flow-file-handles';
const DB_VERSION = 3;
const FILE_HANDLE_STORE_NAME = 'exportHandles';
const DIRECTORY_HANDLE_STORE_NAME = 'exportDirectories';
const RECENT_IMPORT_PROJECT_STORE_NAME = 'recentImportProjects';
const MAX_RECENT_IMPORTED_PROJECTS = 5;

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
      if (!db.objectStoreNames.contains(RECENT_IMPORT_PROJECT_STORE_NAME)) {
        db.createObjectStore(RECENT_IMPORT_PROJECT_STORE_NAME);
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

const createRecentImportId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const isSameFileHandle = async (first: unknown, second: unknown): Promise<boolean> => {
  if (!isFileHandle(first) || !isFileHandle(second)) return false;
  const firstHandle = first as { isSameEntry?: (other: unknown) => Promise<boolean> };
  if (typeof firstHandle.isSameEntry !== 'function') return false;

  try {
    return await firstHandle.isSameEntry(second);
  } catch {
    return false;
  }
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

export const loadRecentImportedProjects = async (limit = MAX_RECENT_IMPORTED_PROJECTS): Promise<RecentImportedProjectEntry[]> => {
  try {
    const db = await openFileHandleDb();
    if (!db) return [];

    try {
      const transaction = db.transaction(RECENT_IMPORT_PROJECT_STORE_NAME, 'readonly');
      const request = transaction.objectStore(RECENT_IMPORT_PROJECT_STORE_NAME).getAll();
      const entries = await waitForRequest(request) as RecentImportedProjectEntry[];
      await waitForTransaction(transaction);

      return entries
        .filter((entry) => entry?.id && isFileHandle(entry.handle))
        .sort((a, b) => new Date(b.importedAt).getTime() - new Date(a.importedAt).getTime())
        .slice(0, limit);
    } finally {
      db.close();
    }
  } catch (error) {
    console.warn('Failed to load recent imported projects:', error);
    return [];
  }
};

export const saveRecentImportedProject = async ({
  fileName,
  projectName,
  handle
}: {
  fileName: string;
  projectName: string;
  handle: unknown;
}): Promise<RecentImportedProjectEntry[]> => {
  if (!isFileHandle(handle)) return loadRecentImportedProjects();

  try {
    const currentEntries = await loadRecentImportedProjects(50);
    let existingEntry: RecentImportedProjectEntry | undefined;

    for (const entry of currentEntries) {
      if (await isSameFileHandle(entry.handle, handle)) {
        existingEntry = entry;
        break;
      }
    }

    const nextEntry: RecentImportedProjectEntry = {
      id: existingEntry?.id || createRecentImportId(),
      fileName,
      projectName,
      importedAt: new Date().toISOString(),
      handle
    };
    const retainedEntries = currentEntries
      .filter((entry) => entry.id !== nextEntry.id)
      .sort((a, b) => new Date(b.importedAt).getTime() - new Date(a.importedAt).getTime())
      .slice(0, MAX_RECENT_IMPORTED_PROJECTS - 1);
    const nextEntries = [nextEntry, ...retainedEntries];
    const nextEntryIds = new Set(nextEntries.map((entry) => entry.id));

    const db = await openFileHandleDb();
    if (!db) return nextEntries;

    try {
      const transaction = db.transaction(RECENT_IMPORT_PROJECT_STORE_NAME, 'readwrite');
      const store = transaction.objectStore(RECENT_IMPORT_PROJECT_STORE_NAME);
      store.put(nextEntry, nextEntry.id);

      currentEntries.forEach((entry) => {
        if (!nextEntryIds.has(entry.id)) store.delete(entry.id);
      });

      await waitForTransaction(transaction);
    } finally {
      db.close();
    }

    return nextEntries;
  } catch (error) {
    console.warn('Failed to save recent imported project:', error);
    return loadRecentImportedProjects();
  }
};

export const removeRecentImportedProject = async (id: string): Promise<RecentImportedProjectEntry[]> => {
  try {
    const currentEntries = await loadRecentImportedProjects(50);
    const nextEntries = currentEntries.filter((entry) => entry.id !== id);

    const db = await openFileHandleDb();
    if (!db) return nextEntries.slice(0, MAX_RECENT_IMPORTED_PROJECTS);

    try {
      const transaction = db.transaction(RECENT_IMPORT_PROJECT_STORE_NAME, 'readwrite');
      transaction.objectStore(RECENT_IMPORT_PROJECT_STORE_NAME).delete(id);
      await waitForTransaction(transaction);
    } finally {
      db.close();
    }

    return nextEntries.slice(0, MAX_RECENT_IMPORTED_PROJECTS);
  } catch (error) {
    console.warn('Failed to remove recent imported project:', error);
    return loadRecentImportedProjects();
  }
};

export const readRecentImportedProjectFile = async (entry: RecentImportedProjectEntry): Promise<File> => {
  if (!isFileHandle(entry.handle)) {
    throw new Error('最近导入记录已失效，请重新选择文件。');
  }

  const handle = entry.handle as {
    getFile: () => Promise<File>;
    queryPermission?: (options: { mode: 'read' }) => Promise<PermissionState>;
    requestPermission?: (options: { mode: 'read' }) => Promise<PermissionState>;
  };
  const permissionOptions = { mode: 'read' as const };

  if (typeof handle.queryPermission === 'function') {
    const permission = await handle.queryPermission(permissionOptions);
    if (permission !== 'granted') {
      const requestedPermission = typeof handle.requestPermission === 'function'
        ? await handle.requestPermission(permissionOptions)
        : permission;

      if (requestedPermission !== 'granted') {
        throw new Error('没有读取该文件的权限，请重新通过 Import JSON 选择文件。');
      }
    }
  }

  return handle.getFile();
};
