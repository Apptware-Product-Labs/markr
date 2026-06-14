/**
 * redact.test.ts — secret redaction for handoffs.
 * Includes false-positive guards (prose "token", UUIDs in paths).
 */
import { describe, it, expect } from 'vitest';
import { redactSecrets } from './redact';

// Assemble secret-SHAPED test fixtures at runtime so no complete secret literal
// sits in the committed source (keeps GitHub push-protection / secret scanners
// happy — these are all fake). The regex under test still sees the full string.
const j = (...parts: string[]): string => parts.join('');

describe('redactSecrets — catches secrets', () => {
  it('Anthropic key', () => {
    const r = redactSecrets('key: sk-ant-api03-AbC123_def456Ghi789jklMNO');
    expect(r.text).toContain('[REDACTED:anthropic-key]');
    expect(r.text).not.toContain('api03-AbC123');
    expect(r.count).toBe(1);
  });

  it('OpenAI key', () => {
    const r = redactSecrets('export OPENAI=sk-abcdefghijklmnopqrstuvwx');
    expect(r.text).toContain('[REDACTED:openai-key]');
    expect(r.count).toBe(1);
  });

  it('OpenAI project key', () => {
    const r = redactSecrets('sk-proj-AbCdEf123456GhIjKl7890MnOpQr');
    expect(r.text).toContain('[REDACTED:openai-key]');
  });

  it('GitHub PAT (ghp_)', () => {
    const r = redactSecrets('token = ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
    expect(r.text).toContain('[REDACTED:github-token]');
    expect(r.text).not.toContain('ghp_ABCDEF');
  });

  it('GitHub fine-grained PAT (github_pat_)', () => {
    const r = redactSecrets('github_pat_11ABCDEFG0123456789_abcdefghijklmnop');
    expect(r.text).toContain('[REDACTED:github-token]');
  });

  it('Slack bot token (xoxb-)', () => {
    const r = redactSecrets(j('SLACK=xox', 'b-123456789012-abcdefghijklmnop'));
    expect(r.text).toContain('[REDACTED:slack-token]');
  });

  it('AWS access key id (AKIA)', () => {
    const r = redactSecrets('aws: AKIAIOSFODNN7EXAMPLE done');
    expect(r.text).toContain('[REDACTED:aws-access-key]');
    expect(r.text).toContain('done');
  });

  it('Google API key (AIza)', () => {
    // Real Google keys are AIza + 35 chars (39 total)
    const r = redactSecrets('AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYz0123456');
    expect(r.text).toContain('[REDACTED:google-key]');
  });

  it('Bearer token keeps the "Bearer " prefix', () => {
    const r = redactSecrets('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    expect(r.text).toContain('Bearer [REDACTED:bearer-token]');
  });

  it('Postgres connection string redacts only the password', () => {
    const r = redactSecrets('postgres://admin:s3cr3tP4ssw0rd@db.internal:5432/app');
    expect(r.text).toContain('postgres://admin:[REDACTED:db-password]@db.internal:5432/app');
    expect(r.text).not.toContain('s3cr3tP4ssw0rd');
  });

  it('mongodb+srv connection string', () => {
    const r = redactSecrets('mongodb+srv://user:LongPassword123@cluster0.mongodb.net');
    expect(r.text).toContain('[REDACTED:db-password]');
    expect(r.text).toContain('cluster0.mongodb.net');
  });

  it('generic key=value assignment', () => {
    const r = redactSecrets('API_KEY="abcdef1234567890ghijkl"');
    expect(r.text).toContain('API_KEY="[REDACTED:secret]"');
    expect(r.text).not.toContain('abcdef1234567890');
  });

  it('prefixed env name AWS_SECRET_ACCESS_KEY (underscore boundaries)', () => {
    const r = redactSecrets('AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY');
    expect(r.text).toContain('AWS_SECRET_ACCESS_KEY=[REDACTED:secret]');
    expect(r.text).not.toContain('wJalrXUtnFEMIK7');
  });

  it('prefixed env name STRIPE_SECRET_KEY', () => {
    const r = redactSecrets(j('STRIPE_SECRET_KEY=sk', '_live_abcdefghijklmnopqrstuvwx'));
    expect(r.text).toContain('STRIPE_SECRET_KEY=[REDACTED:secret]');
  });

  it('PEM private-key block is collapsed', () => {
    const pem = [
      '-----BEGIN RSA PRIVATE KEY-----',
      'MIIEowIBAAKCAQEA1234567890abcdefghijklmnopqrstuvwxyz',
      'QWERTYUIOPasdfghjklZXCVBNM0987654321+/==',
      '-----END RSA PRIVATE KEY-----',
    ].join('\n');
    const r = redactSecrets(`here is the key:\n${pem}\nthanks`);
    expect(r.text).toContain('[REDACTED:private-key]');
    expect(r.text).not.toContain('MIIEowIBAAKCAQEA');
    expect(r.text).toContain('thanks');
  });

  it('counts multiple secrets', () => {
    const r = redactSecrets('sk-abcdefghijklmnopqrstuvwx and ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345');
    expect(r.count).toBe(2);
  });
});

describe('redactSecrets — false-positive guards', () => {
  it('does NOT redact the word "token" in prose', () => {
    const r = redactSecrets('The token expired so I refreshed the session token.');
    expect(r.count).toBe(0);
    expect(r.text).toBe('The token expired so I refreshed the session token.');
  });

  it('does NOT redact a UUID in a file path', () => {
    const p = '/Users/x/.claude/projects/550e8400-e29b-41d4-a716-446655440000/file.ts';
    const r = redactSecrets(p);
    expect(r.count).toBe(0);
    expect(r.text).toBe(p);
  });

  it('does NOT redact "password" with no value', () => {
    const r = redactSecrets('Add a password field to the form.');
    expect(r.count).toBe(0);
  });

  it('does NOT redact a short value after key= (under 12 chars)', () => {
    const r = redactSecrets('token = abc123');
    expect(r.count).toBe(0);
  });

  it('does NOT redact an embedded keyword like "tokenizer" with a path value', () => {
    const r = redactSecrets('tokenizer = ./src/tokenizer-config.ts');
    expect(r.count).toBe(0);
  });

  it('does NOT redact "Bearer <hyphenated-prose>" with no digit', () => {
    const r = redactSecrets('Use the Bearer authentication-scheme-header here.');
    expect(r.count).toBe(0);
    expect(r.text).toContain('Bearer authentication-scheme-header');
  });

  it('is idempotent — does not re-redact existing markers', () => {
    const once = redactSecrets('key: sk-abcdefghijklmnopqrstuvwx');
    const twice = redactSecrets(once.text);
    expect(twice.count).toBe(0);
    expect(twice.text).toBe(once.text);
  });
});
