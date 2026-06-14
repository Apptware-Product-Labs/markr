/**
 * eval/run.mjs — regression gate for CRH mining quality.
 *
 * Runs the PRODUCTION mining (mineByRegex + DECISION_RE/FAIL_RE/CONSTRAINT_RE +
 * the PASTED_CONTENT_RE reject filter) over the labelled fixtures in eval/corpus,
 * computes per-category precision / recall / F1 (micro-averaged), prints a table,
 * and exits non-zero if any category drops below the floor in eval/baseline.json.
 *
 * On first run (no baseline.json) it writes the current F1 (minus a small margin)
 * as the baseline and passes — so `npm run eval` bootstraps itself.
 *
 * Note: written as .mjs (not .ts as the spec suggested) so it runs with plain
 * `node` and no extra toolchain — it bundles src/sessionReader.ts via the esbuild
 * dependency already in the project. Deviation noted in the phase summary.
 *
 * Run: npm run eval
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, existsSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { tmpdir } from 'os';

const DIR  = dirname(fileURLToPath(import.meta.url));
const ROOT = join(DIR, '..');
const CATS = ['decisions', 'deadEnds', 'constraints'];
const CAP  = 50; // generous — measure regex quality, not the display cap

// ── Bundle the production module so we mine with the exact shipping code ──────
const bundled = join(tmpdir(), `markr-eval-sessionReader-${process.pid}.mjs`);
await build({
  entryPoints: [join(ROOT, 'src/sessionReader.ts')],
  bundle: true, platform: 'node', format: 'esm', outfile: bundled, logLevel: 'error',
});
const { mineByRegex, DECISION_RE, FAIL_RE, CONSTRAINT_RE, PASTED_CONTENT_RE } =
  await import(pathToFileURL(bundled).href);

function parseFixture(jsonl) {
  const user = [], assistant = [];
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue;
    let d; try { d = JSON.parse(line); } catch { continue; }
    if (d.type !== 'user' && d.type !== 'assistant') continue;
    const c = d.message?.content;
    let t = '';
    if (Array.isArray(c)) for (const x of c) { if (x?.type === 'text') t += String(x.text || '') + '\n'; }
    else if (typeof c === 'string') t = c;
    t = t.trim();
    if (t) (d.type === 'assistant' ? assistant : user).push(t);
  }
  return { user, assistant };
}

function mineAll(fx) {
  return {
    decisions:   mineByRegex(fx.assistant, DECISION_RE, CAP, PASTED_CONTENT_RE),
    deadEnds:    mineByRegex(fx.assistant, FAIL_RE, CAP, PASTED_CONTENT_RE),
    constraints: mineByRegex(fx.user, CONSTRAINT_RE, CAP, PASTED_CONTENT_RE),
  };
}

const agg = {};
for (const c of CATS) agg[c] = { tp: 0, mined: 0, labels: 0, matched: 0 };

const files = readdirSync(join(DIR, 'corpus')).filter((f) => f.endsWith('.jsonl')).sort();
for (const f of files) {
  const fx = parseFixture(readFileSync(join(DIR, 'corpus', f), 'utf8'));
  const mined = mineAll(fx);
  const labels = JSON.parse(readFileSync(join(DIR, 'labels', f.replace('.jsonl', '.json')), 'utf8'));
  for (const c of CATS) {
    const m = mined[c] || [], l = labels[c] || [];
    agg[c].mined  += m.length;
    agg[c].labels += l.length;
    for (const item of m) if (l.some((lab) => item.toLowerCase().includes(lab.toLowerCase()))) agg[c].tp++;
    for (const lab of l) if (m.some((item) => item.toLowerCase().includes(lab.toLowerCase()))) agg[c].matched++;
  }
}

function prf(a) {
  const precision = a.mined === 0 ? 1 : a.tp / a.mined;
  const recall    = a.labels === 0 ? 1 : a.matched / a.labels;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

const results = {};
for (const c of CATS) results[c] = prf(agg[c]);

rmSync(bundled, { force: true });

console.log(`\nCRH mining eval — ${files.length} fixtures\n`);
console.log('category      precision   recall      f1');
console.log('-----------   ---------   --------   ------');
for (const c of CATS) {
  const r = results[c];
  console.log(
    c.padEnd(13),
    r.precision.toFixed(2).padStart(8),
    r.recall.toFixed(2).padStart(9),
    r.f1.toFixed(2).padStart(8),
  );
}

const baselinePath = join(DIR, 'baseline.json');
if (!existsSync(baselinePath)) {
  const floors = {};
  for (const c of CATS) floors[c] = { f1: Math.max(0, +(results[c].f1 - 0.05).toFixed(2)) };
  writeFileSync(baselinePath, JSON.stringify(floors, null, 2) + '\n');
  console.log('\nNo baseline found — wrote eval/baseline.json (current F1 − 0.05 margin). Re-run to gate.');
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
let failed = false;
for (const c of CATS) {
  const floor = baseline[c]?.f1 ?? 0;
  if (results[c].f1 < floor) {
    console.log(`✗ ${c}: F1 ${results[c].f1.toFixed(2)} below floor ${floor}`);
    failed = true;
  }
}
console.log(failed ? '\n✗ EVAL FAILED — mining regressed below baseline.' : '\n✓ EVAL PASSED — at or above baseline.');
process.exit(failed ? 1 : 0);
