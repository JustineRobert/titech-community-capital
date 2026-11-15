import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const component = read('frontend/src/pages/GroupDetails.jsx');
const styles = read('frontend/src/pages/GroupDetails.css');

test('Group Details page styles every page-specific component used by its JSX', () => {
  const requiredClasses = [
    'group-details-page',
    'group-details-header',
    'group-header-navigation',
    'group-title-area',
    'group-title-icon',
    'group-title-meta',
    'group-platform-label',
    'group-status-badge',
    'status-dot',
    'group-header-details',
    'group-stats-grid',
    'group-stat-card',
    'group-stat-content',
    'group-details-layout',
    'group-details-main',
    'group-details-sidebar',
    'group-panel',
    'contribution-panel',
    'members-panel',
    'membership-requests-panel',
    'group-information-grid',
    'information-item',
    'contribution-form',
    'form-field',
    'required-indicator',
    'field-error',
    'contribution-security-note',
    'contribution-submit',
    'group-inline-alert',
    'group-inline-alert-error',
    'group-inline-alert-success',
    'alert-dismiss',
    'members-list',
    'group-member-card',
    'member-card-content',
    'member-index',
    'member-role-badge',
    'membership-request-list',
    'membership-request-item',
    'membership-request-actions',
    'financial-summary-panel',
    'financial-total',
    'financial-divider',
    'financial-meta',
    'group-details-footer',
    'group-details-footer-copy',
  ];

  const missing = requiredClasses.filter((className) =>
    !new RegExp(`\\.${className}(?![\\w-])`).test(styles)
  );

  assert.deepEqual(missing, [], `Group Details classes without page styles: ${missing.join(', ')}`);
});

test('Group Details styling uses official semantic tokens and remains legible in both theme modes', () => {
  assert.match(styles, /var\(--titech-color-background\)/);
  assert.match(styles, /var\(--titech-color-surface\)/);
  assert.match(styles, /var\(--titech-color-text\)/);
  assert.match(styles, /var\(--titech-color-text-muted\)/);
  assert.match(styles, /var\(--titech-focus-ring\)/);
  assert.match(styles, /var\(--titech-state-success\)/);
  assert.match(styles, /var\(--titech-state-warning\)/);
  assert.match(styles, /var\(--titech-state-danger\)/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.doesNotMatch(styles, /#[0-9a-f]{3,8}\b/i, 'page CSS must not duplicate palette or semantic color literals');
});

test('Group Details exposes the true group status and uses the shared legal organization profile in its footer', () => {
  assert.match(component, /data-status=\{String\(group\.status/);
  assert.match(component, /import TITECH_BRAND from '\.\.\/branding\/brand'/);
  assert.match(component, /\{TITECH_BRAND\.fullName\}/);
  assert.match(component, /\{TITECH_BRAND\.legalName\}/);
  assert.match(component, /entityRegistrationNumber\}/);
  assert.match(component, /Postal correspondence:/);
  assert.match(component, /\{TITECH_BRAND\.tagline\}/);
});
