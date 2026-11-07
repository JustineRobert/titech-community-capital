import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const applyChanges = process.argv.includes('--apply');
const backupStamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupRoot = path.join(root, '.titech-remediation-backups', `legal-brand-name-${backupStamp}`);
const patches = [];

function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    patches.push({ relativePath, status: 'SKIP — file does not exist in this checkout' });
    return null;
  }
  return { absolutePath, content: fs.readFileSync(absolutePath, 'utf8') };
}

function planText(relativePath, exactPairs) {
  const file = read(relativePath);
  if (!file) return;
  let next = file.content;
  let changed = false;
  for (const [oldValue, newValue] of exactPairs) {
    const count = next.split(oldValue).length - 1;
    if (count === 0) continue;
    if (count !== 1) {
      patches.push({ relativePath, status: `BLOCKED — expected one exact occurrence of ${JSON.stringify(oldValue)}, found ${count}` });
      return;
    }
    next = next.replace(oldValue, newValue);
    changed = true;
  }
  if (!changed) {
    const looksAlreadyUpdated = exactPairs.every(([, newValue]) => file.content.includes(newValue));
    patches.push({ relativePath, status: looksAlreadyUpdated ? 'ALREADY CORRECT' : 'NO CHANGE — old string not found; inspect manually' });
    return;
  }
  patches.push({ relativePath, status: 'PLANNED UPDATE', absolutePath: file.absolutePath, next });
}

function planJsonAuthor(relativePath, replacementMap) {
  const file = read(relativePath);
  if (!file) return;
  let data;
  try { data = JSON.parse(file.content); }
  catch { patches.push({ relativePath, status: 'BLOCKED — invalid JSON; no change made' }); return; }
  if (typeof data.author !== 'string') {
    patches.push({ relativePath, status: 'SKIP — no top-level author field' });
    return;
  }
  let nextAuthor = data.author;
  for (const [oldValue, newValue] of replacementMap) nextAuthor = nextAuthor.replace(oldValue, newValue);
  if (nextAuthor === data.author) {
    patches.push({ relativePath, status: data.author.includes('TITech Capital LTD') ? 'ALREADY CORRECT' : 'NO CHANGE — author is different; manual review required' });
    return;
  }
  data.author = nextAuthor;
  const next = `${JSON.stringify(data, null, 2)}\n`;
  patches.push({ relativePath, status: 'PLANNED UPDATE', absolutePath: file.absolutePath, next });
}

// Preserve the official nine-color theme; update only the corporate-identity field.
{
  const relativePath = 'branding/TITECH_OFFICIAL_THEME.json';
  const file = read(relativePath);
  if (file) {
    try {
      const data = JSON.parse(file.content);
      const allowed = new Set(['TITech Africa', 'TITech Community Capital LTD', 'TITech Capital LTD']);
      if (!allowed.has(data.organization)) {
        patches.push({ relativePath, status: `BLOCKED — unexpected organization value ${JSON.stringify(data.organization)}` });
      } else if (data.organization === 'TITech Capital LTD') {
        patches.push({ relativePath, status: 'ALREADY CORRECT' });
      } else {
        data.organization = 'TITech Capital LTD';
        patches.push({ relativePath, status: 'PLANNED UPDATE', absolutePath: file.absolutePath, next: `${JSON.stringify(data, null, 2)}\n` });
      }
    } catch {
      patches.push({ relativePath, status: 'BLOCKED — invalid JSON; no change made' });
    }
  }
}

planText('frontend/src/branding/brand.js', [
  ["legalName: 'TITech Community Capital LTD'", "legalName: 'TITech Capital LTD'"],
]);
const oldAuthor = 'TITech Community Capital LTD';
planJsonAuthor('package.json', [[oldAuthor, 'TITech Capital LTD']]);
planJsonAuthor('backend/package.json', [[oldAuthor, 'TITech Capital LTD']]);
planJsonAuthor('package-lock.json', [[oldAuthor, 'TITech Capital LTD']]);
planJsonAuthor('backend/package-lock.json', [[oldAuthor, 'TITech Capital LTD']]);

const blockers = patches.filter((item) => item.status.startsWith('BLOCKED'));
const planned = patches.filter((item) => item.status === 'PLANNED UPDATE');
console.log('TITech legal-brand identity patch');
console.log(`Mode: ${applyChanges ? 'APPLY' : 'DRY RUN (default)'}`);
for (const item of patches) console.log(`${item.status.padEnd(48)} ${item.relativePath}`);

if (blockers.length) {
  console.error(`\nStopped: ${blockers.length} file(s) have unexpected content. No files were written.`);
  process.exitCode = 1;
} else if (!applyChanges) {
  console.log(`\nDry run complete: ${planned.length} file(s) would change. Re-run with --apply to write only planned files.`);
} else {
  fs.mkdirSync(backupRoot, { recursive: true });
  for (const item of planned) {
    const relative = path.relative(root, item.absolutePath);
    const backupPath = path.join(backupRoot, relative);
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.copyFileSync(item.absolutePath, backupPath, fs.constants.COPYFILE_EXCL);
  }
  for (const item of planned) fs.writeFileSync(item.absolutePath, item.next, 'utf8');
  console.log(`\nApplied ${planned.length} file(s). Pre-change copies: ${path.relative(root, backupRoot)}`);
}
