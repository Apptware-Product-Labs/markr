# Skill: Code Review

> This skill reviews TypeScript and JavaScript code for correctness, security, and maintainability. It specialises in VS Code extension patterns, webview security, and async/streaming code.

---

## Trigger

Use this skill when asked to:
- Review a diff or PR before merging
- Audit a specific file for security issues
- Check error handling in async code
- Validate streaming/SSE implementations

---

## Review Checklist

### Security
- [ ] User input rendered via `textContent` not `innerHTML`
- [ ] API keys in SecretStorage, not settings or code
- [ ] HTTP response status codes checked before parsing body
- [ ] No sensitive data in URLs or query strings (use headers)

### Correctness
- [ ] Double-callback guards on streaming (use `finished` flag)
- [ ] Panel disposal handled — `postMessage` wrapped in try/catch
- [ ] Promise rejections caught and reported to user
- [ ] Request timeout set on all `https.request` calls

### VS Code Patterns
- [ ] Disposables registered with `context.subscriptions`
- [ ] `fs.watch` cleaned up in `dispose()`
- [ ] `retainContextWhenHidden` set when webview state must persist
- [ ] No synchronous I/O on large files in extension host

---

## Output Format

```
## Review: [file/PR name]

### 🔴 Critical
- [issue]: [why it matters] → [fix]

### 🟠 High  
- [issue]: [why it matters] → [fix]

### 🟢 Looks Good
- [positive observations]
```

---

## Context

This skill has knowledge of:
- Markr's architecture (see `AGENTS.md`)
- Common VS Code extension pitfalls
- Anthropic, OpenAI, and Google streaming API patterns
- XSS vectors in VS Code webviews
