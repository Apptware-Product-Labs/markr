/**
 * configLabStore.ts — local storage for AI Config Lab test suites.
 *
 * Tests live in `.markr/config-tests.json` at the workspace root, one suite per
 * AI config file. Pure suite operations (find / get / upsert / delete) are
 * separated from the fs IO so they're unit-tested without touching disk.
 *
 * LOCAL-ONLY: plain JSON in the user's repo, written ONLY via explicit user
 * action (saving a test). Never auto-created.
 */
import * as fs   from 'fs';
import * as path from 'path';

export type TestStatus = 'pass' | 'fail' | 'manual';

export interface ConfigTestCase {
  id:               string;
  name:             string;
  prompt:           string;
  expectedBehavior?: string;
  mustInclude?:     string[];
  mustNotInclude?:  string[];
  provider?:        string;   // last-used provider (convenience)
  model?:           string;   // last-used model
  /** Last run outcome + the config it ran against (powers stale/regression UI). */
  lastRun?:         { status: TestStatus; at: number; configHash: string };
}

export interface ConfigTestSuite {
  configPath: string;         // workspace-relative, POSIX
  tests:      ConfigTestCase[];
}

export interface ConfigTestsFile {
  version: 1;
  suites:  ConfigTestSuite[];
}

export const CONFIG_TESTS_REL = path.join('.markr', 'config-tests.json');

// ─── Pure operations (no IO) ────────────────────────────────────────────────

export function emptyTestsFile(): ConfigTestsFile {
  return { version: 1, suites: [] };
}

/** Normalize a config path to a stable, workspace-relative POSIX key. */
export function normalizeConfigPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

export function findSuite(file: ConfigTestsFile, configPath: string): ConfigTestSuite | undefined {
  const key = normalizeConfigPath(configPath);
  return file.suites.find(s => normalizeConfigPath(s.configPath) === key);
}

export function getTestsForConfig(file: ConfigTestsFile, configPath: string): ConfigTestCase[] {
  return findSuite(file, configPath)?.tests ?? [];
}

/**
 * Add or update a test for a config file, preserving all other suites and tests.
 * Returns the same file object (mutated) for convenience.
 */
export function upsertTest(file: ConfigTestsFile, configPath: string, test: ConfigTestCase): ConfigTestsFile {
  const key = normalizeConfigPath(configPath);
  let suite = file.suites.find(s => normalizeConfigPath(s.configPath) === key);
  if (!suite) {
    suite = { configPath: key, tests: [] };
    file.suites.push(suite);
  }
  const idx = suite.tests.findIndex(t => t.id === test.id);
  if (idx >= 0) suite.tests[idx] = test;
  else suite.tests.push(test);
  return file;
}

export function deleteTest(file: ConfigTestsFile, configPath: string, id: string): ConfigTestsFile {
  const suite = findSuite(file, configPath);
  if (suite) suite.tests = suite.tests.filter(t => t.id !== id);
  return file;
}

// ─── File IO ────────────────────────────────────────────────────────────────

export function loadTestsFile(workspaceRoot: string): ConfigTestsFile {
  try {
    const raw = fs.readFileSync(path.join(workspaceRoot, CONFIG_TESTS_REL), 'utf-8');
    const parsed = JSON.parse(raw) as ConfigTestsFile;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.suites)) return emptyTestsFile();
    return parsed;
  } catch {
    return emptyTestsFile();
  }
}

export function saveTestsFile(workspaceRoot: string, file: ConfigTestsFile): void {
  const dir = path.join(workspaceRoot, '.markr');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, CONFIG_TESTS_REL), JSON.stringify(file, null, 2) + '\n');
}
