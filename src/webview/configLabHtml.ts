/**
 * configLabHtml.ts — AI Config Lab webview shell.
 *
 * The shell HTML is static; test cards + results are rendered client-side from
 * state posted by the extension (configLabRunner). All user/model content is set
 * via textContent (never innerHTML). Themed with the shared markrUI system.
 */
import { MARKR_UI_TOKENS, MARKR_UI_COMPONENTS } from './markrUI';

export function buildConfigLabHtml(): string {
  return /* html */`<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
* { box-sizing: border-box; }
${MARKR_UI_TOKENS}
${MARKR_UI_COMPONENTS}
body { font-family: var(--vscode-font-family, system-ui); color: var(--ui-fg);
  background: var(--ui-bg); padding: 16px 20px 40px; margin: 0; font-size: 13px; }
h1 { font-size: 16px; margin: 0 0 2px; }
.sub { color: var(--muted); font-size: 12px; margin-bottom: 4px; }
.cfg { font-family: var(--vscode-editor-font-family, monospace); color: var(--accent); }
.bar { display: flex; align-items: center; gap: 8px; margin: 14px 0; flex-wrap: wrap; }
.btn { padding: 5px 12px; border-radius: var(--r-sm); cursor: pointer; font-size: 12px; font-weight: 650;
  border: 1px solid transparent; color: var(--accent-fg);
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  box-shadow: 0 2px 8px color-mix(in srgb, var(--accent-2) 35%, transparent);
  transition: background var(--ease), transform .08s; }
.btn:hover { background: linear-gradient(135deg, #FDBA74, var(--accent)); }
.btn:active { transform: translateY(1px); }
.btn.secondary { background: var(--s2); color: var(--ui-fg); border-color: var(--line);
  box-shadow: none; font-weight: 500; }
.btn.secondary:hover { background: var(--s3); }
.spacer { flex: 1; }
.notice { padding: 12px 14px; border-radius: var(--r); background: var(--s1);
  border: 1px solid var(--line-soft); border-left: 3px solid var(--accent);
  box-shadow: var(--sh-1); margin-bottom: 14px; font-size: 12px; line-height: 1.5; }
.card { border: 1px solid var(--line-soft); border-radius: var(--r);
  padding: 12px 14px; margin-bottom: 12px; background: var(--s1); box-shadow: var(--sh-1); }
.card-top { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.tname { font-weight: 600; font-size: 13px; flex: 1; }
.badge { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: var(--r-pill); text-transform: uppercase; letter-spacing: .03em; }
.badge.pass { background: rgba(34,197,94,.18); color: #22c55e; }
.badge.fail { background: rgba(239,68,68,.18); color: #ef4444; }
.badge.manual { background: var(--s3); color: var(--muted); }
.badge.stale { background: rgba(234,179,8,.18); color: #eab308; }
.banner { padding: 9px 13px; border-radius: var(--r); margin-bottom: 12px; font-size: 12px; box-shadow: var(--sh-1); }
.banner.warn { background: rgba(234,179,8,.12); border: 1px solid rgba(234,179,8,.4); }
.banner.ok { background: rgba(34,197,94,.12); border: 1px solid rgba(34,197,94,.35); }
.regress { font-size: 11px; font-weight: 600; margin-left: 6px; }
.regress.regressed { color: #ef4444; }
.regress.fixed { color: #22c55e; }
label { display: block; font-size: 10.5px; color: var(--muted); margin: 8px 0 3px; text-transform: uppercase; letter-spacing: .03em; }
input, textarea, select { width: 100%; background: var(--s1); color: var(--ui-fg);
  border: 1px solid var(--line); border-radius: var(--r-sm); padding: 6px 9px; font-size: 12px;
  font-family: inherit; outline: none; transition: border-color var(--ease), box-shadow var(--ease); }
input:focus, textarea:focus, select:focus { border-color: color-mix(in srgb, var(--accent) 60%, transparent); box-shadow: var(--ring); }
textarea { resize: vertical; min-height: 38px; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.run-row { display: flex; align-items: center; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
.run-row select { width: auto; min-width: 120px; flex: 0 1 auto; }
.result { margin-top: 10px; border-top: 1px solid var(--line-soft); padding-top: 8px; }
.result-out { white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.5;
  max-height: 320px; overflow-y: auto; background: var(--s2);
  border-radius: var(--r-sm); padding: 8px 10px; }
.result-summary { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 6px; }
.muted { color: var(--vscode-descriptionForeground); }
.empty { padding: 30px; text-align: center; color: var(--vscode-descriptionForeground); }
.del { background: transparent; border: none; color: var(--vscode-descriptionForeground); cursor: pointer; font-size: 14px; }
.del:hover { color: #ef4444; }
.redacted-note { font-size: 10px; color: var(--vscode-descriptionForeground); margin-top: 4px; }
</style></head><body>
<h1>AI Config Lab</h1>
<div class="sub">Instruction source: <span class="cfg" id="cfg-path">…</span></div>
<div id="notice"></div>
<div id="banner"></div>
<div class="bar">
  <button class="btn" id="add">+ Add test</button>
  <button class="btn secondary" id="run-all">Run all</button>
  <button class="btn secondary" id="add-key">🔑 API key</button>
  <span class="spacer"></span>
  <span class="muted" id="provider-info"></span>
</div>
<div id="root"><div class="empty">Loading…</div></div>

<script>
(function(){
  'use strict';
  var vsc = acquireVsCodeApi();
  var STATE = { configPath: '', tests: [], providers: [], models: [], hasKey: false };

  function modelOptionsFor(provider){
    return STATE.models.filter(function(m){ return m.provider === provider; });
  }
  function el(tag, cls, text){ var e = document.createElement(tag); if(cls) e.className = cls; if(text!=null) e.textContent = text; return e; }

  function providerSelect(test){
    var wrap = el('div');
    var pl = el('label', null, 'Provider'); wrap.appendChild(pl);
    var rowSel = el('div', 'run-row');
    var ps = el('select'); ps.dataset.role = 'provider';
    STATE.providers.forEach(function(p){ var o = el('option', null, p); o.value = p; if(test.provider===p) o.selected=true; ps.appendChild(o); });
    var ms = el('select'); ms.dataset.role = 'model';
    function fillModels(){ ms.textContent=''; modelOptionsFor(ps.value).forEach(function(m){ var o=el('option',null,m.label); o.value=m.id; if(test.model===m.id) o.selected=true; ms.appendChild(o); }); }
    ps.addEventListener('change', fillModels); fillModels();
    rowSel.appendChild(ps); rowSel.appendChild(ms);
    wrap.appendChild(rowSel);
    return { wrap: wrap, provider: ps, model: ms };
  }

  function render(){
    document.getElementById('cfg-path').textContent = STATE.configPath || '(none)';
    var pinfo = document.getElementById('provider-info');
    pinfo.textContent = STATE.providers.length ? ('Providers: ' + STATE.providers.join(', ')) : 'No provider key configured';

    var notice = document.getElementById('notice');
    notice.textContent = '';
    if(!STATE.providers.length){
      var n = el('div','notice');
      n.appendChild(el('div', null, 'No AI provider key configured — Markr won’t send anything yet. Add a key (stored encrypted in VS Code SecretStorage, never in your repo) to run tests. You can still create and edit test cases.'));
      var nb = el('button','btn','🔑 Add API key'); nb.style.marginTop = '10px';
      nb.addEventListener('click', function(){ vsc.postMessage({ type:'addKey' }); });
      n.appendChild(nb);
      notice.appendChild(n);
    }

    var root = document.getElementById('root');
    root.textContent = '';
    if(!STATE.tests.length){
      root.appendChild(el('div','empty','No test cases yet. Click "+ Add test" to create one.'));
      return;
    }
    STATE.tests.forEach(function(t){ root.appendChild(card(t)); });
  }

  function card(t){
    var c = el('div','card'); c.dataset.id = t.id;
    var top = el('div','card-top');
    var name = el('input'); name.value = t.name || ''; name.dataset.role='name'; name.className='tname';
    var badge = el('span','badge manual'); badge.dataset.role='badge'; badge.style.display='none';
    if (t.lastRun) { badge.style.display='inline-block'; badge.className='badge '+t.lastRun.status; badge.textContent=t.lastRun.status; }
    var stale = el('span','badge stale','stale'); stale.dataset.role='stale'; stale.title='Config changed since this test last ran — re-run it.';
    stale.style.display = (t.lastRun && STATE.configHash && t.lastRun.configHash !== STATE.configHash) ? 'inline-block' : 'none';
    var del = el('button','del','✕'); del.title='Delete test';
    del.addEventListener('click', function(){ vsc.postMessage({ type:'deleteTest', id:t.id }); });
    top.appendChild(name); top.appendChild(badge); top.appendChild(stale); top.appendChild(del);
    c.appendChild(top);

    c.appendChild(el('label',null,'User prompt'));
    var prompt = el('textarea'); prompt.value = t.prompt || ''; prompt.dataset.role='prompt'; c.appendChild(prompt);

    c.appendChild(el('label',null,'Expected behavior (manual note)'));
    var exp = el('textarea'); exp.value = t.expectedBehavior || ''; exp.dataset.role='expected'; c.appendChild(exp);

    var two = el('div','two');
    var incWrap = el('div');
    incWrap.appendChild(el('label',null,'Must include (comma-separated)'));
    var inc = el('input'); inc.value=(t.mustInclude||[]).join(', '); inc.dataset.role='inc'; incWrap.appendChild(inc);
    var excWrap = el('div');
    excWrap.appendChild(el('label',null,'Must NOT include (comma-separated)'));
    var exc = el('input'); exc.value=(t.mustNotInclude||[]).join(', '); exc.dataset.role='exc'; excWrap.appendChild(exc);
    two.appendChild(incWrap); two.appendChild(excWrap);
    c.appendChild(two);

    var sel = providerSelect(t);
    c.appendChild(sel.wrap);

    var runRow = el('div','run-row');
    var save = el('button','btn secondary','Save');
    var run = el('button','btn','▶ Run'); if(!STATE.providers.length) run.disabled = true;
    function collect(){
      return {
        id: t.id,
        name: name.value.trim() || 'Untitled test',
        prompt: prompt.value,
        expectedBehavior: exp.value,
        mustInclude: inc.value.split(',').map(function(s){return s.trim();}).filter(Boolean),
        mustNotInclude: exc.value.split(',').map(function(s){return s.trim();}).filter(Boolean),
        provider: sel.provider.value, model: sel.model.value
      };
    }
    save.addEventListener('click', function(){ vsc.postMessage({ type:'saveTest', test: collect() }); });
    run.addEventListener('click', function(){
      vsc.postMessage({ type:'saveTest', test: collect() });
      vsc.postMessage({ type:'runTest', id:t.id, provider: sel.provider.value, model: sel.model.value });
    });
    runRow.appendChild(run); runRow.appendChild(save);
    c.appendChild(runRow);

    var result = el('div','result'); result.dataset.role='result'; result.style.display='none';
    var out = el('div','result-out'); out.dataset.role='out';
    var summary = el('div','result-summary'); summary.dataset.role='summary';
    result.appendChild(out); result.appendChild(summary);
    c.appendChild(result);
    return c;
  }

  function cardById(id){ return document.querySelector('.card[data-id="'+ (window.CSS&&CSS.escape?CSS.escape(id):id) +'"]'); }
  function showResult(id){ var c=cardById(id); if(!c) return null; var r=c.querySelector('[data-role=result]'); r.style.display='block'; return c; }

  window.addEventListener('message', function(ev){
    var msg = ev.data;
    if(msg.type === 'state'){ STATE = msg.state; render(); }
    if(msg.type === 'runStart'){ var c=showResult(msg.id); if(c){ c.querySelector('[data-role=out]').textContent=''; c.querySelector('[data-role=summary]').textContent='Running…'; var b=c.querySelector('[data-role=badge]'); b.style.display='none'; } }
    if(msg.type === 'runChunk'){ var c2=showResult(msg.id); if(c2){ c2.querySelector('[data-role=out]').textContent += msg.text; } }
    if(msg.type === 'runDone'){ var c3=showResult(msg.id); if(c3){
      var b=c3.querySelector('[data-role=badge]'); b.style.display='inline-block';
      b.className = 'badge ' + msg.status; b.textContent = msg.status;
      // It just ran against the current config → no longer stale.
      var st=c3.querySelector('[data-role=stale]'); if(st) st.style.display='none';
      // Regression indicator (passing → failing) or fixed.
      var existing=b.parentNode.querySelector('.regress'); if(existing) existing.remove();
      if(msg.regression==='regressed' || msg.regression==='fixed'){
        var r=el('span','regress '+msg.regression, msg.regression==='regressed'?'⚠ regressed':'✓ fixed');
        b.parentNode.insertBefore(r, b.nextSibling);
      }
      c3.querySelector('[data-role=summary]').textContent = msg.summary + (msg.redactions? (' · ' + msg.redactions + ' secret(s) redacted before sending') : '');
    } }
    if(msg.type === 'runAllDone'){
      var banner=document.getElementById('banner'); banner.textContent='';
      var bn=el('div','banner '+(msg.regressed?'warn':'ok'));
      bn.textContent = msg.regressed
        ? ('Ran '+msg.total+' tests · '+msg.regressed+' regressed (was passing, now failing)'+(msg.fixed?(' · '+msg.fixed+' fixed'):''))
        : ('Ran '+msg.total+' tests · no regressions'+(msg.fixed?(' · '+msg.fixed+' fixed'):''));
      banner.appendChild(bn);
    }
    if(msg.type === 'runError'){ var c4=showResult(msg.id); if(c4){ c4.querySelector('[data-role=summary]').textContent = 'Error: ' + msg.error; } }
  });

  document.getElementById('add').addEventListener('click', function(){ vsc.postMessage({ type:'addTest' }); });
  document.getElementById('run-all').addEventListener('click', function(){ vsc.postMessage({ type:'runAll' }); });
  document.getElementById('add-key').addEventListener('click', function(){ vsc.postMessage({ type:'addKey' }); });

  vsc.postMessage({ type:'ready' });
}());
</script>
</body></html>`;
}
