#!/usr/bin/env node
import net from 'node:net';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const minNode = [24, 15];
const backendPort = Number(process.env.PORT || 5000);
const frontendPort = Number(process.env.FRONTEND_PORT || 3000);
const mongoPort = Number(process.env.MONGO_PORT || 27017);
const redisPort = Number(process.env.REDIS_PORT || 6379);
const apiOrigin = process.env.VITE_API_URL || 'http://localhost:5000';

function semverTuple(version) {
  const match = String(version).match(/v?(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : [0, 0, 0];
}

function atLeast(version, minimum) {
  const current = semverTuple(version);
  return current[0] > minimum[0] || (current[0] === minimum[0] && current[1] >= minimum[1]);
}

function portInUse(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (error) => resolve(error?.code === 'EADDRINUSE'));
    server.once('listening', () => server.close(() => resolve(false)));
    server.listen(port, host);
  });
}

async function main() {
  const nodeReady = atLeast(process.version, minNode);
  let npmVersion = 'unavailable';
try { npmVersion = execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--version'], { encoding: 'utf8' }).trim(); } catch {}
  const frontendEnv = path.join(root, 'frontend', '.env.development');
  const backendEnv = path.join(root, 'backend', '.env');
  const frontendInUse = await portInUse(frontendPort);
  const backendInUse = await portInUse(backendPort);

  console.log('TITech Development Environment Preflight');
  console.log('────────────────────────────────────────');
  console.log(`Node            : ${process.version} ${nodeReady ? 'READY' : 'UNSUPPORTED (requires >=24.15.0)'}`);
  console.log(`npm             : ${npmVersion}`);
  console.log(`Frontend        : http://localhost:${frontendPort} ${frontendInUse ? 'IN USE' : 'AVAILABLE'}`);
  console.log(`Backend         : http://localhost:${backendPort} ${backendInUse ? 'IN USE' : 'AVAILABLE'}`);
  console.log(`API origin      : ${apiOrigin}`);
  console.log(`Frontend env    : ${fs.existsSync(frontendEnv) ? 'FOUND' : 'MISSING'}`);
  console.log(`Backend .env    : ${fs.existsSync(backendEnv) ? 'FOUND' : 'NOT FOUND (process env may be used)'}`);
  console.log(`MongoDB         : 127.0.0.1:${mongoPort} ${await portInUse(mongoPort) ? 'IN USE' : 'NOT LISTENING'}`);
  console.log(`Redis           : 127.0.0.1:${redisPort} ${await portInUse(redisPort) ? 'IN USE' : 'NOT LISTENING'}`);

  if (!nodeReady) {
    process.exitCode = 1;
    return;
  }

  if (frontendInUse || backendInUse) {
    console.error('TITECH_DEV_PORT_CONFLICT: close the existing frontend/backend process or use the supported two-terminal startup.');
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('TITECH_RUNTIME_PREFLIGHT_FAILED', error?.message || error);
  process.exitCode = 1;
});
