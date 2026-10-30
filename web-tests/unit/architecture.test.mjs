// Enforces the layering described in ARCHITECTURE.md, so it cannot erode unnoticed.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const JS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../app/src/main/assets/js');

// folder -> the folders it may import from (besides itself)
const ALLOWED = {
  core: [],
  text: [],
  ui: ['core'],
  services: ['core', 'text'],
  document: ['core', 'services', 'text', 'ui'],
  viewer: ['core', 'document', 'text'],
  player: ['core', 'document', 'services', 'text', 'ui', 'viewer'],
  settings: ['core', 'player', 'services', 'ui'],
  search: ['core', 'document', 'text', 'viewer'],
  app: ['core', 'document', 'player', 'search', 'services', 'settings', 'ui', 'viewer'],
  '.': ['core', 'document', 'player', 'services', 'settings', 'ui', 'viewer', 'app', 'text', 'search']   // main.js
};

function listModules(dir = JS_ROOT) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listModules(full) : entry.name.endsWith('.js') ? [full] : [];
  });
}

const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '');
const layerOf = (file) => path.relative(JS_ROOT, path.dirname(file)).split(path.sep)[0] || '.';

const modules = listModules();
const sources = new Map(modules.map((file) => [file, fs.readFileSync(file, 'utf8')]));
const imports = new Map();
for (const [file, source] of sources) {
  const targets = [...stripComments(source).matchAll(/from\s+'(\.[^']+)'/g)].map((m) => path.resolve(path.dirname(file), m[1]));
  imports.set(file, targets);
}

test('every import resolves to an existing module', () => {
  for (const [file, targets] of imports) {
    for (const target of targets) assert.ok(sources.has(target), `${path.relative(JS_ROOT, file)} imports missing ${path.relative(JS_ROOT, target)}`);
  }
});

test('layers only import from the layers below them', () => {
  const violations = [];
  for (const [file, targets] of imports) {
    const from = layerOf(file);
    for (const target of targets) {
      const to = layerOf(target);
      if (to !== from && !(ALLOWED[from] || []).includes(to)) {
        violations.push(`${path.relative(JS_ROOT, file)} (${from}) -> ${path.relative(JS_ROOT, target)} (${to})`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test('there are no import cycles between modules', () => {
  const state = new Map();
  const cycles = [];
  const visit = (file, trail) => {
    state.set(file, 'open');
    for (const target of imports.get(file) || []) {
      if (state.get(target) === 'open') cycles.push([...trail, file, target].map((f) => path.relative(JS_ROOT, f)).join(' -> '));
      else if (!state.has(target)) visit(target, [...trail, file]);
    }
    state.set(file, 'done');
  };
  for (const file of modules) if (!state.has(file)) visit(file, []);
  assert.deepEqual(cycles, []);
});

test('pure-logic and document layers never touch the DOM or browser globals', () => {
  const offenders = [];
  for (const [file, source] of sources) {
    if (!['text', 'document'].includes(layerOf(file))) continue;
    const code = stripComments(source);
    if (/\b(document|window|localStorage|navigator)\b\./.test(code) || /\bel\./.test(code)) offenders.push(path.relative(JS_ROOT, file));
  }
  assert.deepEqual(offenders, []);
});

test('nothing runs at import time: feature modules only export (main.js is the sole caller of init functions)', () => {
  const offenders = [];
  for (const [file, source] of sources) {
    if (path.basename(file) === 'main.js') continue;
    if (/^init[A-Z]\w*\(\);?\s*$/m.test(stripComments(source))) offenders.push(path.relative(JS_ROOT, file));
  }
  assert.deepEqual(offenders, []);
});
