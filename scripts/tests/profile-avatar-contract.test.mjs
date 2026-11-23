import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  getUserAvatarUrl,
  getUserDisplayName,
  getUserInitials,
} from '../../frontend/src/utils/userAvatar.mjs';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('profile avatar resolution prefers an existing authenticated profile image', () => {
  assert.equal(
    getUserAvatarUrl({ avatar: 'https://cdn.example.test/member.jpg' }),
    'https://cdn.example.test/member.jpg',
  );
  assert.equal(
    getUserAvatarUrl({ avatarUrl: ' ', avatar: 'https://cdn.example.test/fallback.png' }),
    'https://cdn.example.test/fallback.png',
  );
  assert.equal(
    getUserAvatarUrl({ profileImage: 'https://cdn.example.test/profile.webp' }),
    'https://cdn.example.test/profile.webp',
  );
});

test('profile avatar resolution rejects unsafe, malformed and credential-bearing URLs', () => {
  assert.equal(getUserAvatarUrl({ avatar: 'javascript:alert(1)' }), null);
  assert.equal(getUserAvatarUrl({ avatar: 'data:image/svg+xml,<svg />' }), null);
  assert.equal(getUserAvatarUrl({ avatar: '//cdn.example.test/avatar.png' }), null);
  assert.equal(getUserAvatarUrl({ avatar: '/uploads/avatar.png' }), null);
  assert.equal(getUserAvatarUrl({ avatar: 'https://user:pass@cdn.example.test/a.png' }), null);
  assert.equal(getUserAvatarUrl({ avatar: 'https://cdn.example.test/' + 'a'.repeat(2050) }), null);
});

test('profile display name resolves common API profile fields without changing session data', () => {
  assert.equal(getUserDisplayName({ name: 'Amina N.' }), 'Amina N.');
  assert.equal(getUserDisplayName({ firstName: 'Amina', lastName: 'N.' }), 'Amina N.');
  assert.equal(getUserDisplayName({ email: 'amina@example.test' }), 'amina@example.test');
  assert.equal(getUserDisplayName(null), 'TITech User');
});

test('avatar initials remain deterministic for names, email aliases and missing profiles', () => {
  assert.equal(getUserInitials('Amina N.'), 'AN');
  assert.equal(getUserInitials('amina.n@example.test'), 'AN');
  assert.equal(getUserInitials('member@example.test'), 'ME');
  assert.equal(getUserInitials(''), 'TU');
});

test('authenticated navigation and settings surfaces use the shared avatar component', () => {
  const navbar = read('frontend/src/components/Navbar.jsx');
  const dashboardHeader = read('frontend/src/pages/dashboard/DashboardHeader.jsx');
  const settings = read('frontend/src/pages/Settings.jsx');

  assert.match(navbar, /import ProfileAvatar from "\.\/ui\/ProfileAvatar"/);
  assert.equal((navbar.match(/<ProfileAvatar\b/g) || []).length, 3);
  assert.match(dashboardHeader, /<ProfileAvatar[\s\S]*?user=\{user\}/);
  assert.match(settings, /<ProfileAvatar[\s\S]*?user=\{user\}/);
});

test('dashboard header stylesheet exists, uses official semantic tokens and supports mobile layouts', () => {
  const component = read('frontend/src/pages/dashboard/DashboardHeader.jsx');
  const stylesheet = read('frontend/src/pages/dashboard/DashboardHeader.css');

  assert.match(component, /import "\.\/DashboardHeader\.css"/);
  assert.match(stylesheet, /--titech-color-surface/);
  assert.match(stylesheet, /--titech-color-surface-muted/);
  assert.match(stylesheet, /--titech-official-electric-blue/);
  assert.match(stylesheet, /@media \(max-width: 600px\)/);
  assert.match(stylesheet, /prefers-reduced-motion/);
  assert.doesNotMatch(stylesheet, /#[0-9a-f]{3,8}\b/i);
});
