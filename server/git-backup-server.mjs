import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.FLOW_GIT_SERVER_PORT || 5174);
const FLOW_PROJECTS_DIR = path.resolve(process.cwd(), 'flow-projects');
const BACKUP_PROJECTS_DIRNAME = 'projects';
const FLOW_GLOBAL_PROJECTS_DIR = path.join(FLOW_PROJECTS_DIR, 'global');
const DEFAULT_GLOBAL_PROJECT_NAME = '任务计划';
const TASK_PLAN_PROJECT_PATH = 'global/任务计划.json';
const TODAY_TODO_PROJECT_PATH = 'global/今日待办.json';
const TODAY_TODO_PROJECT_NAME = '今日待办';
const TASK_TITLE_DATE_PATTERN = /^(.*?)\s*\[(\d{4}-\d{2}-\d{2})\]\s*$/;
const GIT_TIMEOUT_MS = Number(process.env.FLOW_GIT_TIMEOUT_MS || 20000);
const DEFAULT_HTTP_PROXY = 'http://127.0.0.1:7890';
const DEFAULT_HTTPS_PROXY = 'http://127.0.0.1:7890';

const sendJson = (res, statusCode, payload) => {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(payload));
};

const readJsonBody = (req) =>
  new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 5 * 1024 * 1024) {
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });

const sanitizeFilename = (name) => {
  const fallback = 'untitled-project';
  const safe = String(name || fallback)
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_');
  return safe || fallback;
};

const getNowStamp = () => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const sec = String(now.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${sec}`;
};

const generateId = () => Math.random().toString(36).slice(2, 12);

const formatDateString = (date = new Date()) => {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const buildNodeContent = (title, desc = '', body = '') => {
  const lines = [`# ${title}`, desc ? `> ${desc}` : '', body || ''];
  return lines.join('\n');
};

const ensureProjectDataShape = (projectData) => {
  if (!projectData || typeof projectData !== 'object' || !Array.isArray(projectData.nodes) || !projectData.contentMap) {
    throw new Error('项目文件格式无效');
  }
};

const normalizeProjectData = (projectData, projectPath) => {
  ensureProjectDataShape(projectData);
  return {
    ...projectData,
    currentProjectPath: projectPath
  };
};

const extractNodeBody = (contentMap, nodeId) => {
  const raw = contentMap?.[nodeId] || '';
  const lines = raw.split('\n');
  return lines.slice(2).join('\n');
};

const buildDefaultTaskPlanProject = () => {
  const now = new Date().toISOString();
  const monthId = generateId();
  const weekId = generateId();
  const dayId = generateId();
  const template = [
    '# ',
    '',
    '- 问题/情景',
    '',
    '- 原因/假设',
    '',
    '- 目标',
    '',
    '- 解决方案/行动',
    '',
    '- 结果',
    '',
    '- 下一步计划',
    ''
  ].join('\n');

  return normalizeProjectData({
    projectName: DEFAULT_GLOBAL_PROJECT_NAME,
    nodes: [
      { id: monthId, text: '月计划', desc: '', status: 'waiting', depth: 0, collapsed: false, order: 0, lastModified: now },
      { id: weekId, text: '本周计划', desc: '', status: 'waiting', depth: 0, collapsed: false, order: 0, lastModified: now },
      { id: dayId, text: '今日任务', desc: '', status: 'waiting', depth: 0, collapsed: false, order: 0, lastModified: now }
    ],
    contentMap: {
      root: '',
      [monthId]: template,
      [weekId]: template,
      [dayId]: template
    },
    activeNodeId: monthId,
    focusedNodeId: null,
    layoutMode: 'horizontal',
    metadata: {
      version: '2.0.0',
      createdAt: now,
      lastModified: now,
      lastExported: now
    },
    ui: {
      viewMode: 'split',
      showOutlineDetails: true,
      theme: 'light',
      outlineMode: 'tree',
      hideOnHold: false,
      showFocusedRoot: false,
      useNodeTemplate: true,
      autoBackupOnSaveVersion: false
    }
  }, TASK_PLAN_PROJECT_PATH);
};

const getProjectDisplayName = (relativePath, projectData) => {
  if (typeof projectData?.projectName === 'string' && projectData.projectName.trim()) {
    return projectData.projectName.trim();
  }
  const basename = path.basename(relativePath);
  return basename.replace(/\.json$/i, '');
};

const isInsideDirectory = (targetPath, parentDir) => {
  const relative = path.relative(parentDir, targetPath);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
};

const resolveProjectPath = (relativePath) => {
  if (!relativePath || typeof relativePath !== 'string') {
    throw new Error('projectPath is required');
  }

  const normalizedRelativePath = relativePath.replace(/\\/g, '/');
  const resolvedPath = path.resolve(FLOW_PROJECTS_DIR, normalizedRelativePath);

  if (!resolvedPath.toLowerCase().endsWith('.json')) {
    throw new Error('仅支持读取 JSON 项目文件');
  }

  if (!isInsideDirectory(resolvedPath, FLOW_PROJECTS_DIR)) {
    throw new Error('projectPath 超出 flow-projects 目录范围');
  }

  return {
    resolvedPath,
    relativePath: path.relative(FLOW_PROJECTS_DIR, resolvedPath).replace(/\\/g, '/')
  };
};

const readProjectFile = async (relativePath) => {
  const { resolvedPath, relativePath: normalizedPath } = resolveProjectPath(relativePath);
  const fileContent = await fs.readFile(resolvedPath, 'utf-8');
  const projectData = normalizeProjectData(JSON.parse(fileContent), normalizedPath);
  return {
    projectPath: normalizedPath,
    projectData
  };
};

const writeProjectFile = async (relativePath, projectData) => {
  const { resolvedPath, relativePath: normalizedPath } = resolveProjectPath(relativePath);
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
  const normalizedProjectData = normalizeProjectData(projectData, normalizedPath);
  await fs.writeFile(resolvedPath, `${JSON.stringify(normalizedProjectData, null, 2)}\n`, 'utf-8');
  return {
    projectPath: normalizedPath,
    projectData: normalizedProjectData
  };
};

const isGlobalProjectPath = (projectPath) => typeof projectPath === 'string' && projectPath.startsWith('global/');

const readProjectSummary = async (fullPath, relativePath) => {
  try {
    const parsed = JSON.parse(await fs.readFile(fullPath, 'utf-8'));
    return getProjectDisplayName(relativePath, parsed);
  } catch {
    return getProjectDisplayName(relativePath);
  }
};

const collectProjectFiles = async (directoryPath, { isGlobal }) => {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true }).catch(() => []);
  const projects = [];

  for (const entry of entries) {
    const fullPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      if (!isGlobal && entry.name === 'global') {
        continue;
      }
      projects.push(...(await collectProjectFiles(fullPath, { isGlobal })));
      continue;
    }

    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) {
      continue;
    }

    const stats = await fs.stat(fullPath);
    const relativePath = path.relative(FLOW_PROJECTS_DIR, fullPath).replace(/\\/g, '/');
    const displayName = await readProjectSummary(fullPath, relativePath);
    projects.push({
      name: entry.name,
      displayName,
      relativePath,
      isGlobal,
      modifiedAt: stats.mtime.toISOString(),
      modifiedTs: stats.mtimeMs
    });
  }

  return projects;
};

const listProjects = async () => {
  await fs.mkdir(FLOW_PROJECTS_DIR, { recursive: true });

  const [globalProjects, regularProjects] = await Promise.all([
    collectProjectFiles(FLOW_GLOBAL_PROJECTS_DIR, { isGlobal: true }),
    collectProjectFiles(FLOW_PROJECTS_DIR, { isGlobal: false })
  ]);

  globalProjects.sort((a, b) => b.modifiedTs - a.modifiedTs || a.displayName.localeCompare(b.displayName, 'zh-CN'));
  regularProjects.sort((a, b) => b.modifiedTs - a.modifiedTs || a.displayName.localeCompare(b.displayName, 'zh-CN'));

  return [...globalProjects, ...regularProjects].map(({ modifiedTs, ...project }) => project);
};

const hasGlobalProjects = async () => {
  const entries = await fs.readdir(FLOW_GLOBAL_PROJECTS_DIR, { withFileTypes: true }).catch(() => []);
  return entries.some((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'));
};

const getProjectsPayload = async () => ({
  projects: await listProjects(),
  canCreateDefaultTaskPlan: !(await hasGlobalProjects())
});

const createDefaultTaskPlanProject = async () => {
  if (await hasGlobalProjects()) {
    throw new Error('global 目录中已存在项目，暂不显示默认创建入口');
  }
  return writeProjectFile(TASK_PLAN_PROJECT_PATH, buildDefaultTaskPlanProject());
};

const parseScheduledTask = (node) => {
  if (!node?.text) return null;
  const match = node.text.match(TASK_TITLE_DATE_PATTERN);
  if (!match) return null;
  return {
    title: match[1].trim(),
    dueDate: match[2]
  };
};

const buildTodayTodoProject = (taskPlanData) => {
  const nowIso = new Date().toISOString();
  const today = formatDateString();
  const todayNodes = [];
  const todayContentMap = { root: '' };

  taskPlanData.nodes.forEach((node, index) => {
    const scheduled = parseScheduledTask(node);
    if (!scheduled || scheduled.dueDate !== today) return;

    const todoNodeId = generateId();
    const body = extractNodeBody(taskPlanData.contentMap, node.id);
    todayNodes.push({
      id: todoNodeId,
      text: scheduled.title,
      desc: node.desc || '',
      status: node.status,
      depth: 0,
      collapsed: false,
      order: index,
      lastModified: nowIso,
      sourceNodeId: node.id
    });
    todayContentMap[todoNodeId] = buildNodeContent(scheduled.title, node.desc || '', body);
  });

  if (todayNodes.length === 0) {
    const emptyId = generateId();
    todayNodes.push({
      id: emptyId,
      text: '今日暂无任务',
      desc: '',
      status: 'waiting',
      depth: 0,
      collapsed: false,
      order: 0,
      lastModified: nowIso
    });
    todayContentMap[emptyId] = buildNodeContent('今日暂无任务');
  }

  return normalizeProjectData({
    projectName: `${TODAY_TODO_PROJECT_NAME} ${today}`,
    nodes: todayNodes,
    contentMap: todayContentMap,
    activeNodeId: todayNodes[0]?.id || null,
    focusedNodeId: null,
    layoutMode: 'horizontal',
    metadata: {
      version: '2.0.0',
      createdAt: taskPlanData.metadata?.createdAt || nowIso,
      lastModified: nowIso,
      lastExported: nowIso
    },
    ui: {
      viewMode: taskPlanData.ui?.viewMode || 'split',
      showOutlineDetails: taskPlanData.ui?.showOutlineDetails ?? true,
      theme: taskPlanData.ui?.theme || 'light',
      outlineMode: taskPlanData.ui?.outlineMode || 'tree',
      hideOnHold: taskPlanData.ui?.hideOnHold ?? false,
      showFocusedRoot: false,
      useNodeTemplate: false,
      autoBackupOnSaveVersion: taskPlanData.ui?.autoBackupOnSaveVersion ?? false
    }
  }, TODAY_TODO_PROJECT_PATH);
};

const saveGlobalProject = async ({ projectPath, projectData }) => {
  if (!isGlobalProjectPath(projectPath)) {
    throw new Error('仅支持保存到 global 项目路径');
  }
  return writeProjectFile(projectPath, projectData);
};

const generateTodayTodos = async ({ taskPlanData }) => {
  if (!taskPlanData) {
    throw new Error('taskPlanData is required');
  }
  const savedTaskPlan = await writeProjectFile(TASK_PLAN_PROJECT_PATH, taskPlanData);
  const todayTodoProject = buildTodayTodoProject(savedTaskPlan.projectData);
  const savedTodayTodo = await writeProjectFile(TODAY_TODO_PROJECT_PATH, todayTodoProject);
  return {
    ...savedTodayTodo,
    generatedCount: savedTodayTodo.projectData.nodes.filter((node) => node.sourceNodeId).length
  };
};

const syncTodayTodos = async ({ todayTodoData }) => {
  const savedTodayTodo = todayTodoData
    ? await writeProjectFile(TODAY_TODO_PROJECT_PATH, todayTodoData)
    : await readProjectFile(TODAY_TODO_PROJECT_PATH);
  const savedTaskPlan = await readProjectFile(TASK_PLAN_PROJECT_PATH);
  const nowIso = new Date().toISOString();
  const updates = new Map(
    savedTodayTodo.projectData.nodes
      .filter((node) => node.sourceNodeId)
      .map((node) => [node.sourceNodeId, node.status])
  );

  let updatedCount = 0;
  const syncedTaskPlanData = normalizeProjectData({
    ...savedTaskPlan.projectData,
    nodes: savedTaskPlan.projectData.nodes.map((node) => {
      const nextStatus = updates.get(node.id);
      if (!nextStatus || nextStatus === node.status) {
        return node;
      }
      updatedCount += 1;
      return {
        ...node,
        status: nextStatus,
        lastModified: nowIso
      };
    }),
    metadata: {
      ...savedTaskPlan.projectData.metadata,
      lastModified: nowIso,
      lastExported: nowIso
    }
  }, TASK_PLAN_PROJECT_PATH);

  await writeProjectFile(TASK_PLAN_PROJECT_PATH, syncedTaskPlanData);

  return {
    updatedCount,
    taskPlanProjectPath: TASK_PLAN_PROJECT_PATH,
    taskPlanData: syncedTaskPlanData,
    todayTodoProjectPath: savedTodayTodo.projectPath,
    todayTodoData: savedTodayTodo.projectData
  };
};

const buildGitEnv = (proxyOptions) => {
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'never'
  };

  if (proxyOptions?.proxyEnabled) {
    env.HTTP_PROXY = proxyOptions.httpProxy || DEFAULT_HTTP_PROXY;
    env.HTTPS_PROXY = proxyOptions.httpsProxy || DEFAULT_HTTPS_PROXY;
    env.http_proxy = env.HTTP_PROXY;
    env.https_proxy = env.HTTPS_PROXY;
  } else {
    delete env.HTTP_PROXY;
    delete env.HTTPS_PROXY;
    delete env.http_proxy;
    delete env.https_proxy;
  }

  return env;
};

const runGit = (args, cwd, proxyOptions) =>
  new Promise((resolve, reject) => {
    const commandLabel = `git ${args.join(' ')}`;
    const child = spawn('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: buildGitEnv(proxyOptions)
    });

    let stdout = '';
    let stderr = '';
    let timeoutTriggered = false;

    const timer = setTimeout(() => {
      timeoutTriggered = true;
      child.kill('SIGKILL');
    }, GIT_TIMEOUT_MS);

    child.stdout.on('data', (buf) => {
      stdout += buf.toString();
    });

    child.stderr.on('data', (buf) => {
      stderr += buf.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (timeoutTriggered) {
        reject(new Error(`${commandLabel} timed out after ${GIT_TIMEOUT_MS}ms. 请检查网络和 GitHub 凭据。`));
        return;
      }
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const summary = (stderr || stdout || `${commandLabel} failed`).trim();
        reject(new Error(summary));
      }
    });
  });

const configureRepositoryIdentity = async (cwd, proxyOptions) => {
  await runGit(['config', 'user.name', 'flow-backup'], cwd, proxyOptions).catch(() => {});
  await runGit(['config', 'user.email', 'flow-backup@local'], cwd, proxyOptions).catch(() => {});
};

const hasPathChanged = async (cwd, pathname, proxyOptions) => {
  const status = await runGit(['status', '--porcelain', '--', pathname], cwd, proxyOptions);
  return status.stdout.trim().length > 0;
};

const pathExists = async (targetPath) =>
  fs.access(targetPath)
    .then(() => true)
    .catch(() => false);

const collectLocalProjectFiles = async (directoryPath, baseDir = directoryPath) => {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true }).catch(() => []);
  const files = [];

  for (const entry of entries) {
    if (entry.name === '.git') {
      continue;
    }

    const fullPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectLocalProjectFiles(fullPath, baseDir)));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    files.push({
      sourcePath: fullPath,
      relativePath: path.relative(baseDir, fullPath).replace(/\\/g, '/')
    });
  }

  return files;
};

const createBackupWorkspace = async (repoUrl, proxyOptions) => {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-backup-'));

  try {
    await runGit(['init'], workspaceDir, proxyOptions);
    await configureRepositoryIdentity(workspaceDir, proxyOptions);
    await runGit(['remote', 'add', 'origin', repoUrl], workspaceDir, proxyOptions);

    let hasRemoteMain = false;

    try {
      await runGit(['fetch', 'origin', 'main'], workspaceDir, proxyOptions);
      hasRemoteMain = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const canInitializeMain =
        /couldn't find remote ref main/i.test(message) ||
        /Remote branch main not found/i.test(message) ||
        /Couldn't find remote ref refs\/heads\/main/i.test(message);

      if (!canInitializeMain) {
        throw error;
      }
    }

    if (hasRemoteMain) {
      await runGit(['checkout', '-B', 'main', 'origin/main'], workspaceDir, proxyOptions);
    } else {
      await runGit(['checkout', '--orphan', 'main'], workspaceDir, proxyOptions);
    }

    return workspaceDir;
  } catch (error) {
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
};

const mirrorProjectsToBackupWorkspace = async (workspaceDir) => {
  const backupProjectsDir = path.join(workspaceDir, BACKUP_PROJECTS_DIRNAME);
  const localFiles = await collectLocalProjectFiles(FLOW_PROJECTS_DIR);

  for (const file of localFiles) {
    const legacyPath = path.join(workspaceDir, file.relativePath);
    if (await pathExists(legacyPath)) {
      await fs.rm(legacyPath, { recursive: true, force: true });
    }
  }

  await fs.rm(backupProjectsDir, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(backupProjectsDir, { recursive: true });

  for (const file of localFiles) {
    const targetPath = path.join(backupProjectsDir, file.relativePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(file.sourcePath, targetPath);
  }

  return {
    backupProjectsDir,
    fileCount: localFiles.length
  };
};

const normalizeProxyOptions = ({ proxyEnabled, httpProxy, httpsProxy }) => ({
  proxyEnabled: Boolean(proxyEnabled),
  httpProxy: typeof httpProxy === 'string' && httpProxy.trim() ? httpProxy.trim() : DEFAULT_HTTP_PROXY,
  httpsProxy: typeof httpsProxy === 'string' && httpsProxy.trim() ? httpsProxy.trim() : DEFAULT_HTTPS_PROXY
});

const testConnection = async ({ repoUrl, proxyEnabled, httpProxy, httpsProxy }) => {
  if (!repoUrl || typeof repoUrl !== 'string') {
    throw new Error('repoUrl is required');
  }

  await fs.mkdir(FLOW_PROJECTS_DIR, { recursive: true });
  const proxyOptions = normalizeProxyOptions({ proxyEnabled, httpProxy, httpsProxy });
  const trimmedRepoUrl = repoUrl.trim();
  await runGit(['ls-remote', '--heads', trimmedRepoUrl, 'HEAD'], FLOW_PROJECTS_DIR, proxyOptions);

  return {
    message: '连接成功：仓库可访问，当前凭据可用。'
  };
};

const pushProject = async ({ repoUrl, projectName, projectData, proxyEnabled, httpProxy, httpsProxy }) => {
  if (!repoUrl || typeof repoUrl !== 'string') {
    throw new Error('repoUrl is required');
  }
  if (!projectData || typeof projectData !== 'object') {
    throw new Error('projectData is required');
  }

  const proxyOptions = normalizeProxyOptions({ proxyEnabled, httpProxy, httpsProxy });
  const trimmedRepoUrl = repoUrl.trim();

  const safeProjectName = sanitizeFilename(projectName);
  const requestedProjectPath = typeof projectData.currentProjectPath === 'string' && projectData.currentProjectPath.trim()
    ? projectData.currentProjectPath.trim()
    : `${safeProjectName}.json`;
  const { resolvedPath, relativePath } = resolveProjectPath(requestedProjectPath);
  const normalizedProjectData = normalizeProjectData(projectData, relativePath);

  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
  await fs.writeFile(resolvedPath, `${JSON.stringify(normalizedProjectData, null, 2)}
`, 'utf-8');

  const backupProjectPath = path.posix.join(BACKUP_PROJECTS_DIRNAME, relativePath);
  const workspaceDir = await createBackupWorkspace(trimmedRepoUrl, proxyOptions);

  try {
    const { fileCount } = await mirrorProjectsToBackupWorkspace(workspaceDir);

    await runGit(['add', '-A', '--', '.'], workspaceDir, proxyOptions);

    if (!(await hasPathChanged(workspaceDir, '.', proxyOptions))) {
      return {
        message: `无文件变更，已同步远端分支。文件: ${backupProjectPath}`,
        file: backupProjectPath,
        projectPath: relativePath,
        changed: false
      };
    }

    const commitMessage = `backup: ${safeProjectName} ${getNowStamp()}`;
    await runGit(['commit', '-m', commitMessage], workspaceDir, proxyOptions);
    await runGit(['push', '-u', 'origin', 'main'], workspaceDir, proxyOptions);

    return {
      message: `推送成功: ${backupProjectPath}（已同步 ${fileCount} 个项目文件）`,
      file: backupProjectPath,
      projectPath: relativePath,
      changed: true
    };
  } finally {
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => {});
  }
};

const server = createServer(async (req, res) => {
  if (!req.url) {
    sendJson(res, 400, { error: 'Bad Request' });
    return;
  }

  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  if (req.method === 'GET' && req.url === '/api/git/health') {
    sendJson(res, 200, { ok: true, projectDir: FLOW_PROJECTS_DIR });
    return;
  }

  if (req.method === 'GET' && req.url === '/api/projects') {
    try {
      const payload = await getProjectsPayload();
      sendJson(res, 200, payload);
    } catch (error) {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : '读取项目列表失败'
      });
    }
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/api/projects/open?')) {
    try {
      const requestUrl = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
      const projectPath = requestUrl.searchParams.get('path') || '';
      const result = await readProjectFile(projectPath);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : '读取项目失败'
      });
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/api/projects/create-default-task-plan') {
    try {
      const result = await createDefaultTaskPlanProject();
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : '创建任务计划失败'
      });
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/api/projects/save-global') {
    try {
      const body = await readJsonBody(req);
      const result = await saveGlobalProject(body);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : '保存 global 项目失败'
      });
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/api/projects/generate-today-todos') {
    try {
      const body = await readJsonBody(req);
      const result = await generateTodayTodos(body);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : '生成今日待办失败'
      });
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/api/projects/sync-today-todos') {
    try {
      const body = await readJsonBody(req);
      const result = await syncTodayTodos(body);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : '回写完成情况失败'
      });
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/api/git/push') {
    try {
      const body = await readJsonBody(req);
      const result = await pushProject(body);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : 'Push failed'
      });
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/api/git/test-connection') {
    try {
      const body = await readJsonBody(req);
      const result = await testConnection(body);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : 'Connection test failed'
      });
    }
    return;
  }

  sendJson(res, 404, { error: 'Not Found' });
});

server.on('error', (error) => {
  console.error('failed to start flow git backup server:', error);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`flow git backup server is running at http://127.0.0.1:${PORT}`);
  console.log(`flow projects directory: ${FLOW_PROJECTS_DIR}`);
});
