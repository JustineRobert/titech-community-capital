import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NAVIGATION_REGISTRY, PUBLIC_PRODUCT_DISCOVERY } from '../../frontend/src/navigation/navigationRegistry.js';

const navbar = await readFile(new URL('../../frontend/src/components/Navbar.jsx', import.meta.url), 'utf8');
const styles = await readFile(new URL('../../frontend/src/components/Navbar.css', import.meta.url), 'utf8');
const routes = await readFile(new URL('../../frontend/src/routes/AppRoutes.jsx', import.meta.url), 'utf8');

test('Products and Services are derived from the canonical registry and have real route destinations', () => {
  const products = PUBLIC_PRODUCT_DISCOVERY.filter((item) => item.discoveryType === 'product');
  const services = PUBLIC_PRODUCT_DISCOVERY.filter((item) => item.discoveryType === 'service');
  assert.deepEqual(products.map((item) => item.id), ['eduFinance', 'agriculture', 'ubuntuFloat']);
  assert.deepEqual(services.map((item) => item.id), ['groups', 'inclusiveOnboarding', 'retirementSupport', 'educationSupport', 'partnerSupport', 'donations']);
  assert.equal(products.length + services.length, NAVIGATION_REGISTRY.filter((item) => item.discovery).length);
  for (const item of PUBLIC_PRODUCT_DISCOVERY) {
    assert.ok(item.to.startsWith('/'), `${item.id} should use an application route`);
    assert.ok(item.description && item.accessLabel, `${item.id} should describe its actual access boundary`);
  }
  assert.match(routes, /path=\{ROUTES\.EDUFINANCE\}/);
  assert.match(routes, /path=\{ROUTES\.AGRICULTURE\}/);
  assert.match(routes, /path=\{ROUTES\.UBUNTU_FLOAT\}/);
  assert.match(routes, /path=\{ROUTES\.GROUPS\}/);
  assert.match(routes, /path=\{ROUTES\.INCLUSIVE_ONBOARDING\}/);
  assert.match(routes, /path=\{ROUTES\.RETIREMENT_SUPPORT\}/);
  assert.match(routes, /path=\{ROUTES\.EDUCATION_SUPPORT\}/);
  assert.match(routes, /path=\{ROUTES\.PARTNER_SUPPORT\}/);
  assert.match(routes, /path=\{ROUTES\.DONATIONS\}/);
});

test('desktop and mobile discovery controls expose expanded state and controlled panels', () => {
  assert.match(navbar, /id: \"products\", label: \"Products\"/);
  assert.match(navbar, /id: \"services\", label: \"Services\"/);
  assert.match(navbar, /data-testid=\{`\$\{testId\}-\$\{menu\.id\}-trigger`\}/);
  assert.match(navbar, /aria-expanded=\{isOpen\}/);
  assert.match(navbar, /aria-controls=\{`\$\{testId\}-\$\{menu\.id\}-menu`\}/);
  assert.match(navbar, /aria-expanded=\{mobileProductsOpen\}/);
  assert.match(navbar, /aria-expanded=\{mobileServicesOpen\}/);
  assert.match(navbar, /event\.key !== "Escape"/);
  assert.match(navbar, /document\.addEventListener\("pointerdown"/);
  assert.match(navbar, /requiresLogin \? ROUTES\.LOGIN : item\.to/);
  assert.match(navbar, /state=\{requiresLogin \? \{ from: \{ pathname: item\.to \} \} : undefined\}/);
});

test('responsive navigation uses official TITech theme tokens and collapses before tablet layouts crowd', () => {
  assert.match(styles, /@media \(max-width: 70rem\)/);
  assert.match(styles, /@media \(max-width: 35rem\)/);
  assert.match(styles, /var\(--titech-color-surface\)/);
  assert.match(styles, /var\(--titech-color-border\)/);
  assert.match(styles, /var\(--titech-official-electric-blue\)/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(styles, /#(?:[0-9a-fA-F]{3,8})\b/);
});
