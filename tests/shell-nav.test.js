'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const shell = require('../public/shell.js');

const LEGACY_VIEWS = ['terminal', 'news', 'sectors', 'analyze', 'supply', 'watchlist', 'alerts'];
const NEW_VIEWS = ['markets', 'quant'];

test('shell contract version is pinned', () => {
  assert.equal(shell.SHELL_CONTRACT_VERSION, '2026-09-20a');
});

test('primary navigation is the eight-workspace MT2 hierarchy in order', () => {
  assert.deepEqual(
    shell.WORKSPACES.map((w) => w.id),
    ['markets', 'terminal', 'portfolio', 'watchlist', 'research', 'intelligence', 'quant', 'alerts'],
  );
});

test('every enabled target resolves to a real view id that exists in index.html', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const targets = shell.enabledTargets();
  assert.ok(targets.length >= 12, `expected ≥12 enabled targets, got ${targets.length}`);
  for (const target of targets) {
    const r = shell.resolve(target);
    assert.equal(r.enabled, true, `${target} should be enabled`);
    assert.ok([...LEGACY_VIEWS, ...NEW_VIEWS].includes(r.view), `${target} → unknown view ${r.view}`);
    assert.match(html, new RegExp(`id="view-${r.view}"`), `index.html is missing #view-${r.view} for ${target}`);
    if (r.sub) assert.match(html, new RegExp(`id="gi-${r.sub}"`), `index.html is missing #gi-${r.sub} for ${target}`);
  }
});

test('reserved workspaces (Portfolio) can never resolve to a view', () => {
  assert.deepEqual(shell.reservedWorkspaces(), ['portfolio']);
  const r = shell.resolve('portfolio');
  assert.equal(r.enabled, false);
  assert.equal(r.view, null);
  assert.match(r.note, /MT2-4/);
  assert.equal(shell.hashForTarget('portfolio'), '');
  assert.equal(shell.enabledTargets().includes('portfolio'), false);
});

test('market-mode registry exposes exactly one active market during QUARTZ', () => {
  const active = shell.MARKETS.filter((m) => m.active);
  assert.deepEqual(active.map((m) => m.id), ['US']);
  const india = shell.MARKETS.find((m) => m.id === 'IN');
  assert.equal(india.active, false);
  assert.match(india.note, /MT2-3/);
});

test('research and intelligence group the existing surfaces without dropping any', () => {
  assert.deepEqual(shell.resolve('research').view, 'analyze');
  assert.deepEqual(shell.resolve('research/sectors').view, 'sectors');
  const intel = shell.workspace('intelligence').items.map((it) => `${it.view}:${it.sub || ''}`);
  assert.deepEqual(intel, ['news:briefing', 'news:situation', 'news:report', 'supply:', 'news:map']);
});

test('locate() is the inverse of resolve() for every enabled target', () => {
  for (const target of shell.enabledTargets()) {
    const r = shell.resolve(target);
    const back = shell.locate(r.view, r.sub);
    const roundTrip = back.item ? `${back.workspace}/${back.item}` : back.workspace;
    assert.equal(roundTrip, target);
  }
  assert.equal(shell.locate('does-not-exist').workspace, 'terminal');
});

test('legacy ?tab= deep links and hashes map onto the new hierarchy', () => {
  assert.equal(shell.targetFromLegacyTab('alerts'), 'alerts');
  assert.equal(shell.targetFromLegacyTab('analysis'), 'research/sectors');
  assert.equal(shell.targetFromLegacyTab('analyze'), 'research/analyze');
  assert.equal(shell.targetFromLegacyTab('news'), 'intelligence/briefing');
  assert.equal(shell.targetFromLegacyTab('bogus'), null);
  assert.equal(shell.targetFromHash('#/intelligence/map'), 'intelligence/map');
  assert.equal(shell.targetFromHash('#/nope'), null);
  assert.equal(shell.hashForTarget('intelligence/situation'), '#/intelligence/situation');
  assert.equal(shell.hashForTarget('research'), '#/research/analyze');
});
