/**
 * configLabStore.test.ts — suite ops + IO round-trip.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  emptyTestsFile, findSuite, getTestsForConfig, upsertTest, deleteTest,
  loadTestsFile, saveTestsFile, normalizeConfigPath,
  type ConfigTestCase,
} from './configLabStore';

const mk = (over: Partial<ConfigTestCase> = {}): ConfigTestCase => ({
  id: 't1', name: 'Uses project test command', prompt: 'what should I run?', ...over,
});

describe('pure suite ops', () => {
  it('loads an empty suite', () => {
    const f = emptyTestsFile();
    expect(f.version).toBe(1);
    expect(getTestsForConfig(f, 'AGENTS.md')).toEqual([]);
  });

  it('adds a test for a config file', () => {
    const f = upsertTest(emptyTestsFile(), 'AGENTS.md', mk());
    expect(getTestsForConfig(f, 'AGENTS.md')).toHaveLength(1);
    expect(findSuite(f, 'AGENTS.md')?.tests[0].name).toBe('Uses project test command');
  });

  it('matches tests by config path (normalized)', () => {
    const f = upsertTest(emptyTestsFile(), './AGENTS.md', mk());
    expect(getTestsForConfig(f, 'AGENTS.md')).toHaveLength(1);   // ./ stripped
    expect(normalizeConfigPath('.\\dir\\CLAUDE.md')).toBe('dir/CLAUDE.md');
  });

  it('updates an existing test in place (same id), preserving others', () => {
    let f = upsertTest(emptyTestsFile(), 'AGENTS.md', mk({ id: 'a', name: 'A' }));
    f = upsertTest(f, 'AGENTS.md', mk({ id: 'b', name: 'B' }));
    f = upsertTest(f, 'AGENTS.md', mk({ id: 'a', name: 'A2' }));   // update a
    const tests = getTestsForConfig(f, 'AGENTS.md');
    expect(tests).toHaveLength(2);
    expect(tests.find(t => t.id === 'a')!.name).toBe('A2');
    expect(tests.find(t => t.id === 'b')!.name).toBe('B');
  });

  it('preserves other suites when adding a test', () => {
    let f = upsertTest(emptyTestsFile(), 'AGENTS.md', mk({ id: 'a' }));
    f = upsertTest(f, 'CLAUDE.md', mk({ id: 'b' }));
    expect(f.suites).toHaveLength(2);
    expect(getTestsForConfig(f, 'AGENTS.md')).toHaveLength(1);
    expect(getTestsForConfig(f, 'CLAUDE.md')).toHaveLength(1);
  });

  it('deletes a test without touching others', () => {
    let f = upsertTest(emptyTestsFile(), 'AGENTS.md', mk({ id: 'a' }));
    f = upsertTest(f, 'AGENTS.md', mk({ id: 'b' }));
    f = deleteTest(f, 'AGENTS.md', 'a');
    const tests = getTestsForConfig(f, 'AGENTS.md');
    expect(tests).toHaveLength(1);
    expect(tests[0].id).toBe('b');
  });
});

describe('file IO', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'markr-lab-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('returns empty when no file exists (never auto-created)', () => {
    expect(loadTestsFile(dir).suites).toEqual([]);
    expect(fs.existsSync(path.join(dir, '.markr'))).toBe(false);
  });

  it('round-trips a saved suite', () => {
    const f = upsertTest(emptyTestsFile(), 'AGENTS.md', mk({ mustInclude: ['npm test'] }));
    saveTestsFile(dir, f);
    const back = loadTestsFile(dir);
    expect(getTestsForConfig(back, 'AGENTS.md')[0].mustInclude).toEqual(['npm test']);
  });
});
