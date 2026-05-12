/**
 * Tauri HTTP fetch wrapper.
 *
 * Uses @tauri-apps/plugin-http which sends requests from the Rust side,
 * bypassing WebView CORS restrictions. Falls back to global fetch in
 * non-Tauri environments (e.g. vite dev server in browser).
 */

let _loadPromise: Promise<typeof globalThis.fetch> | null = null;

/**
 * Get a fetch function that bypasses CORS in Tauri.
 * Must be called (awaited) before use.
 * Uses a Promise-based singleton to avoid concurrent import races.
 */
export function getTauriFetch(): Promise<typeof globalThis.fetch> {
  if (!_loadPromise) {
    _loadPromise = (async () => {
      try {
        const mod = await import('@tauri-apps/plugin-http');
        return mod.fetch;
      } catch {
        // Not in Tauri environment, fall back to global fetch
        return globalThis.fetch;
      }
    })();
  }
  return _loadPromise;
}
