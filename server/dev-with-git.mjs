import { spawn } from 'node:child_process';

const childProcesses = [];
let shuttingDown = false;

const shutdown = (code = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of childProcesses) {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  }

  setTimeout(() => process.exit(code), 200);
};

const start = (command, args, options = {}) => {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: options.shell ?? false,
    env: process.env
  });

  child.on('exit', (code) => {
    if (!shuttingDown && code && code !== 0) {
      console.error(`${command} exited with code ${code}`);
      shutdown(code);
    }
  });

  childProcesses.push(child);
  return child;
};

start('node', ['server/git-backup-server.mjs']);
start('npm', ['run', 'dev'], { shell: true });

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
