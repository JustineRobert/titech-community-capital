#!/usr/bin/env node
/**
 * Reproducible dependency installation with a non-destructive process guard.
 * This tool never terminates application processes; it refuses installation
 * when an identifiable TITech server is still running so native files cannot
 * be replaced underneath a live process.
 */
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evaluateRuntime } from './titech-supported-runtime-gate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORTS = Object.freeze({ all: [3000, 5000, 9090], backend: [5000, 9090], frontend: [3000] });

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', ...options });
}

function windowsListeners(ports) {
  const portList = ports.join(',');
  const script = `$ports=@(${portList}); $rows=@(foreach($port in $ports){ Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | ForEach-Object { $pidValue=$_.OwningProcess; $process=Get-CimInstance Win32_Process -Filter "ProcessId = $pidValue" -ErrorAction SilentlyContinue; [pscustomobject]@{ Port=$_.LocalPort; Address=$_.LocalAddress; PID=$pidValue; Name=$process.Name; CommandLine=$process.CommandLine } } }); ConvertTo-Json -InputObject $rows -Compress`;
  const result = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script]);
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'PowerShell process inspection failed.').trim());
  const output = result.stdout.trim();
  if (!output || output === 'null') return [];
  const parsed = JSON.parse(output);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function posixListeners(ports) {
  const result = run('ss', ['-ltnp']);
  if (result.status !== 0) throw new Error('Unable to inspect listening processes with ss -ltnp.');
  const listeners = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.match(/(?:\*|\[[^\]]+\]|[\d.]+|[\w:]+):(\d+)\s+.*pid=(\d+)/);
    if (!match) continue;
    const port = Number(match[1]);
    if (!ports.includes(port)) continue;
    const pid = Number(match[2]);
    const details = run('ps', ['-p', String(pid), '-o', 'args=']);
    let commandLine = (details.stdout || '').trim();
    listeners.push({ Port: port, PID: pid, CommandLine: commandLine });
  }
  return listeners;
}

function inspectListeners(ports) {
  return process.platform === 'win32' ? windowsListeners(ports) : posixListeners(ports);
}

function classifyListener(listener) {
  const commandLine = String(listener.CommandLine || '').toLowerCase().replaceAll('\\', '/');
  const root = ROOT.toLowerCase().replaceAll('\\', '/');
  if (commandLine.includes(root) || commandLine.includes('titech-community-capital')) return 'TITECH';
  if (/(?:^|\s)(?:nodemon|vite)(?:\s|$)/.test(commandLine) && /(backend|frontend|server\.js)/.test(commandLine)) return 'TITECH';
  if (/(?:^|\s)(?:node|node\.exe)(?:\s|$)/.test(commandLine) && /(server\.js|vite|nodemon)/.test(commandLine)) return 'UNKNOWN_NODE';
  return 'UNRELATED';
}

function npmInvocation(args, cwd) {
  if (process.env.npm_execpath) {
    return run(process.execPath, [process.env.npm_execpath, ...args], { cwd, stdio: 'inherit' });
  }
  if (process.platform === 'win32') {
    return run('npm.cmd', args, { cwd, stdio: 'inherit', shell: true });
  }
  return run('npm', args, { cwd, stdio: 'inherit' });
}

function parseTarget(argv) {
  const target = argv.find((item) => ['--backend', '--frontend'].includes(item)) || '--all';
  if (argv.some((item) => !['--backend', '--frontend', '--dry-run'].includes(item))) {
    throw new TypeError(`Unsupported safe-install argument: ${argv.find((item) => !['--backend', '--frontend', '--dry-run'].includes(item))}`);
  }
  return { target: target.slice(2), dryRun: argv.includes('--dry-run') };
}

function main() {
  const { target, dryRun } = parseTarget(process.argv.slice(2));
  const runtime = evaluateRuntime({ root: ROOT });
  if (runtime.status !== 'PASS') {
    console.error('TITech installation blocked: supported Node.js/npm runtime is required.');
    for (const failure of runtime.failures) console.error(`- ${failure}`);
    return 1;
  }

  const ports = PORTS[target];
  let listeners;
  try {
    listeners = inspectListeners(ports);
  } catch (error) {
    console.error(`TITech installation blocked: could not safely inspect process ownership: ${error.message}`);
    console.error('Inspect ports 3000, 5000 and 9090 manually before dependency installation.');
    return 1;
  }

  const classified = listeners.map((listener) => ({ ...listener, classification: classifyListener(listener) }));
  if (listeners.length) {
    console.log('Listening processes found on TITech development ports:');
    for (const listener of classified) {
      console.log(`- ${listener.classification}: port ${listener.Port}, PID ${listener.PID}, process ${listener.Name || 'unknown'}: ${listener.CommandLine || 'command line unavailable'}`);
    }
  }
  if (classified.some((listener) => listener.classification !== 'UNRELATED')) {
    console.error('TITech installation blocked: stop the identified TITech process, or manually verify an unknown Node listener, before replacing dependencies.');
    console.error('Use Ctrl+C in the owning development terminal. No process is terminated automatically; unrelated services are not killed.');
    return 1;
  }

  const packages = target === 'all'
    ? [{ name: 'root', cwd: ROOT }, { name: 'backend', cwd: path.join(ROOT, 'backend') }, { name: 'frontend', cwd: path.join(ROOT, 'frontend') }]
    : [{ name: target, cwd: path.join(ROOT, target) }];

  if (dryRun) {
    console.log(`Safe installation dry run: ${packages.map((item) => `${item.name}: npm ci`).join(' → ')}`);
    return 0;
  }

  for (const item of packages) {
    console.log(`\nInstalling ${item.name} dependencies with npm ci...`);
    const result = npmInvocation(['ci'], item.cwd);
    if (result.error || result.status !== 0) {
      const code = Number.isInteger(result.status) ? result.status : 1;
      console.error(`Installation failed for ${item.name}; exit code ${code}.`);
      if (result.error) console.error(result.error.message);
      return code || 1;
    }
  }

  console.log('\nTITech dependency installation completed successfully for all selected packages.');
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`TITech safe installer failed: ${error.message}`);
  process.exitCode = 1;
}
