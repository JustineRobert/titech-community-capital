import test from 'node:test';
import assert from 'node:assert/strict';
import { computeDiscoveryMenuPlacement } from '../../frontend/src/components/navigationMenuPlacement.js';

test('placement helper constrains panel geometry in a narrow viewport near the left edge', () => {
  const result = computeDiscoveryMenuPlacement({
    triggerRect: { left: 4, right: 74, top: 30, bottom: 68, width: 70, height: 38 },
    viewportWidth: 320,
    viewportHeight: 568,
    contentHeight: 700,
  });
  assert.equal(result.width, 296);
  assert.ok(result.left >= 12);
  assert.ok(result.left + result.width <= 308);
  assert.ok(result.top >= 12);
  assert.ok(result.top + result.maxHeight <= 556);
});

test('discovery menu shifts left when the trigger is near the right viewport edge', () => {
  const result = computeDiscoveryMenuPlacement({
    triggerRect: { left: 1810, right: 1900, top: 40, bottom: 80, width: 90, height: 40 },
    viewportWidth: 1920,
    viewportHeight: 1080,
    contentHeight: 460,
  });
  assert.equal(result.width, 688);
  assert.ok(result.left + result.width <= 1908);
  assert.ok(result.left >= 12);
});

test('discovery menu flips above its trigger when below-space is insufficient', () => {
  const result = computeDiscoveryMenuPlacement({
    triggerRect: { left: 600, right: 700, top: 600, bottom: 640, width: 100, height: 40 },
    viewportWidth: 1280,
    viewportHeight: 768,
    contentHeight: 500,
  });
  assert.ok(result.top < 600);
  assert.ok(result.top >= 12);
  assert.ok(result.top + result.maxHeight <= 756);
});

test('discovery menu handles incomplete geometry without throwing', () => {
  assert.equal(computeDiscoveryMenuPlacement({ viewportWidth: 0, viewportHeight: 600 }), null);
});
