/**
 * copy-python-runtime.cjs
 * Copies python-runtime/ to src-tauri/ if it exists.
 * Not part of the main copy-resources flow; handles the optional
 * python-runtime bundle that may or may not be present locally.
 */
const { cpSync, existsSync } = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'python-runtime');
const dest = path.join(__dirname, '..', 'src-tauri', 'python-runtime');

if (existsSync(src)) {
  cpSync(src, dest, { recursive: true });
  console.log('[copy-python-runtime] Copied python-runtime/ → src-tauri/python-runtime/');
} else {
  console.log('[copy-python-runtime] python-runtime/ not found locally, skipping');
}
