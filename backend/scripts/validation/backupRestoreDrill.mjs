#!/usr/bin/env node
/**
 * Destructive backup/restore drill for an explicitly approved disposable DB.
 *
 * Required:
 *   TITECH_DR_DRILL=YES
 *   TITECH_DR_MONGO_URI=mongodb://127.0.0.1:27017/?replicaSet=rs0
 *   TITECH_DR_DATABASE=titech_dr_drill
 *   Docker available with mongo:7-jammy or local mongodump/mongorestore tools.
 *
 * The drill writes only to the named database and drops only that database.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { MongoClient } from 'mongodb';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const REPORT = path.join(ROOT, 'reports', 'backup-restore-drill.json');
const approved = process.env.TITECH_DR_DRILL === 'YES';
const uri = process.env.TITECH_DR_MONGO_URI;
const dbName = process.env.TITECH_DR_DATABASE;
const report = { schemaVersion: '1.0.0', status: 'NOT_VERIFIED', startedAt: new Date().toISOString(), database: dbName || null, steps: [], errors: [] };

function save(exitCode = 1) {
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  process.exit(exitCode);
}

if (!approved) {
  report.status = 'BLOCKED';
  report.errors.push('Set TITECH_DR_DRILL=YES to explicitly authorize a destructive drill.');
  save(1);
}
if (!uri || !dbName) {
  report.status = 'BLOCKED';
  report.errors.push('TITECH_DR_MONGO_URI and TITECH_DR_DATABASE are required.');
  save(1);
}

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, retryWrites: true });
const sentinel = `titech-dr-${Date.now()}`;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'titech-dr-'));
const archive = path.join(tempDir, 'backup.archive.gz');

function toolAvailable(command) {
  try { execFileSync(command, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

function runDumpRestore(tool, args) {
  return execFileSync(tool, args, { stdio: 'inherit' });
}

let db;
try {
  await client.connect();
  db = client.db(dbName);
  await db.collection('_titech_drill').deleteMany({});
  await db.collection('_titech_drill').insertOne({ _id: sentinel, createdAt: new Date(), purpose: 'backup-restore-drill' });
  report.steps.push({ name: 'writeSentinel', status: 'PASS' });

  const canUseLocal = toolAvailable(process.env.MONGODUMP_BIN || 'mongodump') && toolAvailable(process.env.MONGORESTORE_BIN || 'mongorestore');
  if (canUseLocal) {
    runDumpRestore(process.env.MONGODUMP_BIN || 'mongodump', ['--uri', uri, '--db', dbName, '--archive', archive, '--gzip']);
  } else {
    if (!toolAvailable('docker')) throw new Error('Neither mongodump/mongorestore nor docker is available.');
    runDumpRestore('docker', ['run', '--rm', '--network', 'host', '-v', `${tempDir}:/backup`, 'mongo:7-jammy', 'mongodump', '--uri', uri, '--db', dbName, '--archive', '/backup/backup.archive.gz', '--gzip']);
  }
  report.steps.push({ name: 'backup', status: fs.existsSync(archive) ? 'PASS' : 'FAIL', archiveBytes: fs.existsSync(archive) ? fs.statSync(archive).size : 0 });

  await db.dropDatabase();
  report.steps.push({ name: 'dropDatabase', status: 'PASS' });

  if (canUseLocal) {
    runDumpRestore(process.env.MONGORESTORE_BIN || 'mongorestore', ['--uri', uri, '--archive', archive, '--gzip', '--drop']);
  } else {
    runDumpRestore('docker', ['run', '--rm', '--network', 'host', '-v', `${tempDir}:/backup`, 'mongo:7-jammy', 'mongorestore', '--uri', uri, '--archive', '/backup/backup.archive.gz', '--gzip', '--drop']);
  }
  report.steps.push({ name: 'restore', status: 'PASS' });

  const restored = await db.collection('_titech_drill').findOne({ _id: sentinel });
  report.steps.push({ name: 'validateSentinel', status: restored ? 'PASS' : 'FAIL' });
  report.status = restored ? 'PASS' : 'FAIL';
} catch (error) {
  report.errors.push(error?.stack || error?.message || String(error));
  report.status = 'FAIL';
} finally {
  try { await client.close(); } catch {}
  fs.rmSync(tempDir, { recursive: true, force: true });
}

save(report.status === 'PASS' ? 0 : 1);
