/**
 * redact.ts — strip secrets from text before it leaves the session in a handoff.
 *
 * Transcripts routinely contain pasted API keys, tokens and connection strings.
 * A handoff is copied to the clipboard and pasted into ANOTHER AI tool, so any
 * secret in the mined text would be re-exposed. `redactSecrets` runs as the final
 * step of handoff generation (and on any exported report).
 *
 * Design notes:
 *  - Specific provider prefixes (sk-, ghp_, AKIA…) are matched first and exactly,
 *    so we avoid the blunt "long random string" rule that would nuke UUIDs/hashes.
 *  - The generic `key = value` rule requires an assignment AND a 12+ char value,
 *    so the word "token" in prose is never touched.
 *  - We never re-redact an existing `[REDACTED:…]` marker (idempotent).
 *
 * Local-only: no network, no logging of the original values.
 */

export interface RedactionResult {
  text:  string;
  count: number;
}

/**
 * Replace secret values in `input` with `[REDACTED:<kind>]`, preserving the
 * surrounding context. Returns the cleaned text and the number of replacements.
 */
export function redactSecrets(input: string): RedactionResult {
  let text = String(input ?? '');
  let count = 0;
  const hit = (kind: string): string => { count++; return `[REDACTED:${kind}]`; };

  // 0. PEM private-key blocks — collapse the whole block (RSA/EC/OPENSSH/DSA/PGP).
  text = text.replace(
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    () => hit('private-key'),
  );

  // 1. Anthropic keys (sk-ant-…) — matched before the generic sk- rule.
  text = text.replace(/\bsk-ant-[A-Za-z0-9_-]{12,}/g, () => hit('anthropic-key'));

  // 2. OpenAI keys (sk-…, including project keys sk-proj-…).
  text = text.replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g, () => hit('openai-key'));

  // 3. GitHub tokens: ghp_ gho_ ghu_ ghs_ ghr_ + pat (github_pat_…).
  text = text.replace(/\bgh[pousr]_[A-Za-z0-9]{20,}/g, () => hit('github-token'));
  text = text.replace(/\bgithub_pat_[A-Za-z0-9_]{20,}/g, () => hit('github-token'));

  // 4. Slack tokens: xoxb- xoxp- xoxa- xoxr- xoxs-.
  text = text.replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, () => hit('slack-token'));

  // 5. AWS access key id.
  text = text.replace(/\bAKIA[0-9A-Z]{16}\b/g, () => hit('aws-access-key'));

  // 6. Google API key.
  text = text.replace(/\bAIza[0-9A-Za-z_-]{35}\b/g, () => hit('google-key'));

  // 7. Bearer tokens (JWTs etc.) — keep the "Bearer " prefix. Require at least
  //    one digit so hyphenated prose ("Bearer authentication-scheme") is skipped.
  text = text.replace(/\bBearer\s+(?=[A-Za-z0-9._-]*\d)[A-Za-z0-9._-]{16,}/g, () => 'Bearer ' + hit('bearer-token'));

  // 8. Connection strings with inline credentials — redact only the password,
  //    keep scheme, user and host so the context stays readable.
  text = text.replace(
    /\b((?:postgres(?:ql)?|mongodb(?:\+srv)?|mysql|mariadb|redis|amqps?|rediss?):\/\/[^\s:/@]+:)([^\s@/]+)(@)/gi,
    (_m, prefix: string, _pass: string, at: string) => prefix + hit('db-password') + at,
  );

  // 9. Generic assignment: <key-name> = <12+ chars>.
  //    The key-name allows underscore/dash-delimited prefixes and suffixes so
  //    prefixed env names like AWS_SECRET_ACCESS_KEY and STRIPE_SECRET_KEY are
  //    caught (plain \b boundaries fail across underscores). The keyword must be
  //    its OWN delimited segment, so embedded words like "tokenizer" are NOT
  //    matched. Requires an assignment operator AND a long value, so prose like
  //    "the token expired" is never matched. Skips already-redacted markers.
  text = text.replace(
    /\b((?:[A-Za-z0-9]+[_-])*(?:api[_-]?key|secret|token|password|passwd|access[_-]?key|private[_-]?key|client[_-]?secret|auth[_-]?token)(?:[_-][A-Za-z0-9]+)*)(\s*[:=]\s*)(["']?)([^\s"']{12,})(["']?)/gi,
    (m: string, key: string, sep: string, openQ: string, val: string, closeQ: string) => {
      if (/\[REDACTED:/.test(val)) return m;             // don't double-redact
      count++;
      return `${key}${sep}${openQ}[REDACTED:secret]${closeQ}`;
    },
  );

  return { text, count };
}
