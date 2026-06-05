/**
 * promptRunner.ts — Prompt Runner for Markr
 *
 * Lets users test their AI config files as system prompts directly from the editor.
 * API keys are stored in VS Code's encrypted SecretStorage — never in plain text,
 * never in settings.json, never committed to git.
 *
 * Supported providers:
 *   - Anthropic (Claude 3.5 Sonnet, Claude 4 Sonnet, Claude 4 Opus)
 *   - OpenAI    (GPT-4o, GPT-4o-mini, o1, o3-mini)
 *   - Google    (Gemini 2.0 Flash, Gemini 1.5 Pro)
 *
 * Adding a new provider:
 *   1. Add it to Provider type
 *   2. Add its models to MODELS constant
 *   3. Implement its streaming call in streamRun()
 */

import * as vscode from 'vscode';
import * as https  from 'https';

// ─── Types ───────────────────────────────────────────────────────────────────

export type Provider = 'anthropic' | 'openai' | 'google';

export interface ChatMessage {
  role:    'user' | 'assistant';
  content: string;
}

export interface RunOptions {
  provider:     Provider;
  model:        string;
  systemPrompt: string;
  messages:     ChatMessage[];
}

export interface ModelOption {
  id:       string;
  label:    string;
  provider: Provider;
  context:  number;          // context window in tokens
}

// ─── Available models ────────────────────────────────────────────────────────

export const MODELS: ModelOption[] = [
  // Anthropic
  { id: 'claude-sonnet-4-5',         label: 'Claude 4 Sonnet',     provider: 'anthropic', context: 200_000 },
  { id: 'claude-opus-4-5',           label: 'Claude 4 Opus',       provider: 'anthropic', context: 200_000 },
  { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet',   provider: 'anthropic', context: 200_000 },
  { id: 'claude-3-5-haiku-20241022',  label: 'Claude 3.5 Haiku',    provider: 'anthropic', context: 200_000 },
  // OpenAI
  { id: 'gpt-4o',                    label: 'GPT-4o',              provider: 'openai',    context: 128_000 },
  { id: 'gpt-4o-mini',               label: 'GPT-4o mini',         provider: 'openai',    context: 128_000 },
  { id: 'o3-mini',                   label: 'o3-mini',             provider: 'openai',    context: 200_000 },
  // Google
  { id: 'gemini-2.0-flash-exp',      label: 'Gemini 2.0 Flash',    provider: 'google',    context: 1_000_000 },
  { id: 'gemini-1.5-pro',            label: 'Gemini 1.5 Pro',      provider: 'google',    context: 2_000_000 },
];

// ─── Key names in SecretStorage ───────────────────────────────────────────────

const KEY_NAMES: Record<Provider, string> = {
  anthropic: 'markr.apiKey.anthropic',
  openai:    'markr.apiKey.openai',
  google:    'markr.apiKey.google',
};

// ─── PromptRunner ─────────────────────────────────────────────────────────────

export class PromptRunner {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  // ── Key management ─────────────────────────────────────────────────────────

  async setKey(provider: Provider, key: string): Promise<void> {
    await this.secrets.store(KEY_NAMES[provider], key.trim());
  }

  async getKey(provider: Provider): Promise<string | undefined> {
    return this.secrets.get(KEY_NAMES[provider]);
  }

  async deleteKey(provider: Provider): Promise<void> {
    await this.secrets.delete(KEY_NAMES[provider]);
  }

  async hasKey(provider: Provider): Promise<boolean> {
    const k = await this.getKey(provider);
    return !!(k && k.length > 10);
  }

  /** Returns which providers have keys configured. */
  async configuredProviders(): Promise<Provider[]> {
    const all: Provider[] = ['anthropic', 'openai', 'google'];
    const results = await Promise.all(all.map(p => this.hasKey(p)));
    return all.filter((_, i) => results[i]);
  }

  // ── Streaming run ──────────────────────────────────────────────────────────

  /**
   * Stream a prompt run to the webview via a callback.
   * Calls onChunk with each text chunk as it arrives.
   * Calls onDone when the stream ends.
   * Calls onError if something goes wrong.
   */
  async streamRun(
    opts:    RunOptions,
    onChunk: (text: string) => void,
    onDone:  () => void,
    onError: (err: string) => void,
  ): Promise<void> {
    const key = await this.getKey(opts.provider);
    if (!key) {
      onError(`No API key configured for ${opts.provider}. Add it via the ▶ Run button.`);
      return;
    }
    try {
      switch (opts.provider) {
        case 'anthropic': return await this._runAnthropic(key, opts, onChunk, onDone, onError);
        case 'openai':    return await this._runOpenAI(key, opts, onChunk, onDone, onError);
        case 'google':    return await this._runGoogle(key, opts, onChunk, onDone, onError);
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  // ── Provider implementations ───────────────────────────────────────────────

  private _runAnthropic(
    key: string, opts: RunOptions,
    onChunk: (t: string) => void, onDone: () => void, onError: (e: string) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model: opts.model,
        max_tokens: 4096,
        stream: true,
        system: opts.systemPrompt,
        messages: opts.messages,
      });
      const req = https.request({
        hostname: 'api.anthropic.com',
        path:     '/v1/messages',
        method:   'POST',
        headers:  {
          'Content-Type':      'application/json',
          'x-api-key':         key,
          'anthropic-version': '2023-06-01',
          'Content-Length':    Buffer.byteLength(body),
        },
      }, res => {
        // 🔴 Fix: check HTTP status before attempting to parse SSE
        if (res.statusCode && res.statusCode >= 400) {
          let errBody = '';
          res.on('data', c => errBody += c);
          res.on('end', () => {
            try { const j = JSON.parse(errBody); onError(`Anthropic ${res.statusCode}: ${j.error?.message ?? errBody.slice(0, 120)}`); }
            catch  { onError(`Anthropic HTTP ${res.statusCode}: ${errBody.slice(0, 120)}`); }
            resolve();
          });
          return;
        }
        res.setEncoding('utf-8');
        let buf = '';
        // 🔴 Fix: guard against double onDone (message_stop fires, then res.on('end') also fires)
        let finished = false;
        const finish = (err?: string) => { if (finished) return; finished = true; err ? onError(err) : onDone(); resolve(); };
        res.on('data', chunk => {
          buf += chunk;
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;
            try {
              const ev = JSON.parse(data);
              if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
                onChunk(ev.delta.text);
              }
              if (ev.type === 'message_stop') { finish(); }
              if (ev.type === 'error') { finish(ev.error?.message ?? 'Anthropic error'); }
            } catch { /* partial JSON — wait for next chunk */ }
          }
        });
        res.on('end', () => finish());
        res.on('error', e => { finish(e.message); });
      });
      req.on('error', e => { onError(e.message); reject(e); });
      // 🟡 Fix: add socket timeout so streams don't hang indefinitely
      req.setTimeout(60_000, () => { req.destroy(); onError('Request timed out after 60s'); });
      req.write(body);
      req.end();
    });
  }

  private _runOpenAI(
    key: string, opts: RunOptions,
    onChunk: (t: string) => void, onDone: () => void, onError: (e: string) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const messages = [
        { role: 'system', content: opts.systemPrompt },
        ...opts.messages,
      ];
      const body = JSON.stringify({ model: opts.model, stream: true, messages });
      const req = https.request({
        hostname: 'api.openai.com',
        path:     '/v1/chat/completions',
        method:   'POST',
        headers:  {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${key}`,
          'Content-Length': Buffer.byteLength(body),
        },
      }, res => {
        if (res.statusCode && res.statusCode >= 400) {
          let errBody = '';
          res.on('data', c => errBody += c);
          res.on('end', () => {
            try { const j = JSON.parse(errBody); onError(`OpenAI ${res.statusCode}: ${j.error?.message ?? errBody.slice(0, 120)}`); }
            catch  { onError(`OpenAI HTTP ${res.statusCode}: ${errBody.slice(0, 120)}`); }
            resolve();
          });
          return;
        }
        res.setEncoding('utf-8');
        let buf = '';
        let finished = false;
        const finish = (err?: string) => { if (finished) return; finished = true; err ? onError(err) : onDone(); resolve(); };
        res.on('data', chunk => {
          buf += chunk;
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') { finish(); return; }
            try {
              const ev = JSON.parse(data);
              const text = ev.choices?.[0]?.delta?.content;
              if (text) onChunk(text);
            } catch { /* partial */ }
          }
        });
        res.on('end', () => finish());
        res.on('error', e => finish(e.message));
      });
      req.on('error', e => { onError(e.message); reject(e); });
      req.setTimeout(60_000, () => { req.destroy(); onError('Request timed out after 60s'); });
      req.write(body);
      req.end();
    });
  }

  private _runGoogle(
    key: string, opts: RunOptions,
    onChunk: (t: string) => void, onDone: () => void, onError: (e: string) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const contents = opts.messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));
      const body = JSON.stringify({
        system_instruction: { parts: [{ text: opts.systemPrompt }] },
        contents,
        generationConfig: { maxOutputTokens: 4096 },
      });
      // 🔴 Fix: API key moved from URL query string to header (was visible in logs/proxies)
      const gPath = `/v1beta/models/${opts.model}:streamGenerateContent?alt=sse`;
      const req = https.request({
        hostname: 'generativelanguage.googleapis.com',
        path:     gPath,
        method:   'POST',
        headers:  {
          'Content-Type':    'application/json',
          'X-Goog-Api-Key':  key,  // secure header, not URL query param
          'Content-Length':  Buffer.byteLength(body),
        },
      }, res => {
        if (res.statusCode && res.statusCode >= 400) {
          let errBody = '';
          res.on('data', c => errBody += c);
          res.on('end', () => {
            try { const j = JSON.parse(errBody); onError(`Google ${res.statusCode}: ${j.error?.message ?? errBody.slice(0, 120)}`); }
            catch  { onError(`Google HTTP ${res.statusCode}: ${errBody.slice(0, 120)}`); }
            resolve();
          });
          return;
        }
        res.setEncoding('utf-8');
        let buf = '';
        let finished = false;
        const finish = (err?: string) => { if (finished) return; finished = true; err ? onError(err) : onDone(); resolve(); };
        res.on('data', chunk => {
          buf += chunk;
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const ev = JSON.parse(line.slice(6));
              const text = ev.candidates?.[0]?.content?.parts?.[0]?.text;
              if (text) onChunk(text);
            } catch { /* partial */ }
          }
        });
        res.on('end', () => finish());
        res.on('error', e => finish(e.message));
      });
      req.on('error', e => { onError(e.message); reject(e); });
      req.setTimeout(60_000, () => { req.destroy(); onError('Request timed out after 60s'); });
      req.write(body);
      req.end();
    });
  }
}
