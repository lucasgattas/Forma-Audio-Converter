import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const rule = selector => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^{}]*)\\}`, 'g'))];
  assert.ok(matches.length, `Missing ${selector}`);
  return matches.at(-1)[1];
};

test('batch list has a dark, green-accented scrollbar separated from content', () => {
  assert.match(rule('.batch-list'), /padding-right:\s*(?:1[2-9]|[2-9]\d)px/);
  assert.match(rule('.batch-list::-webkit-scrollbar-track'), /background:\s*#1[0-9a-f]{5}/i);
  assert.match(rule('.batch-list::-webkit-scrollbar-thumb'), /background:\s*#[0-9a-f]{6}/i);
  assert.match(rule('.batch-list'), /scrollbar-color:/);
});

test('small supporting text has a readable minimum size', () => {
  for (const selector of ['.brand small', '.header-right', '.micro', '.label-row>span,.range-labels', '.bottom-line', 'footer']) {
    assert.match(rule(selector), /font-size:\s*(?:1[1-9]|[2-9]\d)px/, selector);
  }
});

test('intro uses a tighter top gap on desktop and mobile', () => {
  assert.match(css, /\.intro\{padding:\s*40px 0 30px/);
  assert.match(rule('.intro'), /padding-top:\s*30px/);
});
