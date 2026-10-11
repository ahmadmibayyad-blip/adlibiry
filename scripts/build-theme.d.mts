// Types for scripts/build-theme.mjs (used by convex/storeTheme.test.ts and convex/dawnTheme.test.ts).
export function readThemeFolder(dir: string): { files: Record<string, string>; binary: Record<string, string> };
export function readTheme(dir?: string): Record<string, string>;
export function readDawn(dir?: string): { files: Record<string, string>; binary: Record<string, string> };
