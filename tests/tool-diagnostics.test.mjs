import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const backend = readFileSync(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');

test('diagnostics is asynchronous and reports release policy separately', () => {
  assert.match(backend, /async fn check_tool_availability/);
  assert.match(backend, /spawn_blocking\(\|\|/);
  assert.match(backend, /#\[cfg\(feature = "local-installer-test"\)\]\s*\{\s*return tool_check::check_resolved_tools\(local_tool\("ffmpeg"\), local_tool\("ffprobe"\), Duration::from_secs\(5\)\);\s*\}/);
  assert.match(backend, /#\[cfg\(not\(feature = "local-installer-test"\)\)\]\s*tool_check::check_tools\(\)/);
  assert.match(backend, /conversion_allowed: cfg!\(debug_assertions\) \|\| cfg!\(feature = "local-installer-test"\)/);
  assert.match(backend, /if !cfg!\(debug_assertions\) \{ return Err/);
});

test('conversion is gated and diagnostics can be retried', () => {
  assert.match(app, /invoke<ToolsReport>\('check_tool_availability'\)/);
  assert.match(app, /!toolsReady/);
  assert.match(app, /onClick=\{checkTools\}/);
  assert.match(app, /conversion_allowed/);
});
