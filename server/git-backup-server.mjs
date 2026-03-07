import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.FLOW_GIT_SERVER_PORT || 5174);
const FLOW_PROJECTS_DIR = path.resolve(process.cwd(), 'flow-projects');
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

const ensureRepository = async (repoUrl, proxyOptions) => {
  await fs.mkdir(FLOW_PROJECTS_DIR, { recursive: true });

  const gitDir = path.join(FLOW_PROJECTS_DIR, '.git');
  const hasGitDir = await fs
    .access(gitDir)
    .then(() => true)
    .catch(() => false);

  if (!hasGitDir) {
    await runGit(['init'], FLOW_PROJECTS_DIR, proxyOptions);
  }

  await runGit(['config', 'user.name', 'flow-backup'], FLOW_PROJECTS_DIR, proxyOptions).catch(() => {});
  await runGit(['config', 'user.email', 'flow-backup@local'], FLOW_PROJECTS_DIR, proxyOptions).catch(() => {});

  let currentOrigin = '';
  try {
    const remoteResult = await runGit(['remote', 'get-url', 'origin'], FLOW_PROJECTS_DIR, proxyOptions);
    currentOrigin = remoteResult.stdout.trim();
  } catch {
    currentOrigin = '';
  }

  if (!currentOrigin) {
    await runGit(['remote', 'add', 'origin', repoUrl], FLOW_PROJECTS_DIR, proxyOptions);
  } else if (currentOrigin !== repoUrl) {
    await runGit(['remote', 'set-url', 'origin', repoUrl], FLOW_PROJECTS_DIR, proxyOptions);
  }
};

const hasFileChanged = async (filename, proxyOptions) => {
  const status = await runGit(['status', '--porcelain', '--', filename], FLOW_PROJECTS_DIR, proxyOptions);
  return status.stdout.trim().length > 0;
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
  await ensureRepository(repoUrl.trim(), proxyOptions);

  const safeProjectName = sanitizeFilename(projectName);
  const filename = `${safeProjectName}.json`;
  const targetPath = path.join(FLOW_PROJECTS_DIR, filename);

  await fs.writeFile(targetPath, `${JSON.stringify(projectData, null, 2)}\n`, 'utf-8');

  await runGit(['add', '--', filename], FLOW_PROJECTS_DIR, proxyOptions);

  if (!(await hasFileChanged(filename, proxyOptions))) {
    await runGit(['branch', '-M', 'main'], FLOW_PROJECTS_DIR, proxyOptions);
    await runGit(['push', '-u', 'origin', 'main'], FLOW_PROJECTS_DIR, proxyOptions).catch(() => {});
    return {
      message: `无文件变更，已同步远端分支。文件: flow-projects/${filename}`,
      file: filename,
      changed: false
    };
  }

  const commitMessage = `backup: ${safeProjectName} ${getNowStamp()}`;
  await runGit(['commit', '-m', commitMessage], FLOW_PROJECTS_DIR, proxyOptions);
  await runGit(['branch', '-M', 'main'], FLOW_PROJECTS_DIR, proxyOptions);

  try {
    await runGit(['pull', '--rebase', 'origin', 'main'], FLOW_PROJECTS_DIR, proxyOptions);
  } catch {
    // Allow first-push or empty remote cases.
  }

  await runGit(['push', '-u', 'origin', 'main'], FLOW_PROJECTS_DIR, proxyOptions);

  return {
    message: `推送成功: flow-projects/${filename}`,
    file: filename,
    changed: true
  };
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
