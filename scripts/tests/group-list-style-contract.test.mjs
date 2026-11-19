import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8');

const component = await read('../../frontend/src/pages/GroupList.jsx');
const styles = await read('../../frontend/src/pages/GroupList.css');

test('Group List defines distinct, spaced action groups for header and cards', () => {
  for (const selector of [
    '.group-list-header-actions',
    '.group-list-card__actions',
    '.group-list-card__details-button',
    '.group-list-card__join-button',
    '.group-list-refresh-button',
    '.group-list-create-button',
  ]) {
    assert.ok(styles.includes(selector), `missing required selector ${selector}`);
  }

  assert.match(styles, /\.group-list-header-actions,[\s\S]*?\.group-list-card__actions\s*\{[^}]*display:\s*flex/s);
  assert.match(styles, /gap:\s*\.75rem/);
  assert.match(styles, /display:\s*inline-flex/);
  assert.match(styles, /min-height:\s*2\.65rem/);
  assert.match(component, /className="group-list-header-actions"/);
  assert.match(component, /className="group-list-card__actions"/);
});

test('Group List controls wrap and stack at mobile widths without collapsing their hit areas', () => {
  assert.match(styles, /flex-wrap:\s*wrap/);
  assert.match(styles, /@media\s*\(max-width:\s*768px\)/);
  assert.match(styles, /@media\s*\(max-width:\s*420px\)/);
  assert.match(styles, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(styles, /overflow-wrap:\s*anywhere/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(styles, /:focus-visible/);
});

test('Group List uses official semantic theme tokens instead of local palette literals', () => {
  for (const token of [
    '--titech-color-background',
    '--titech-color-surface',
    '--titech-color-text',
    '--titech-color-text-muted',
    '--titech-color-border',
    '--titech-official-electric-blue',
    '--titech-official-deep-blue',
    '--titech-state-success',
    '--titech-state-warning',
    '--titech-state-danger',
    '--titech-focus-ring',
  ]) assert.ok(styles.includes(`var(${token}`), `expected official theme token ${token}`);

  assert.doesNotMatch(styles, /#[0-9a-f]{3,8}\b/i, 'Group List CSS must not duplicate palette or state-color literals');
});
