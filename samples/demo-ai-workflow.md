# AI Agent Architecture — Velmeni Health

> **Project:** Velmeni · **Stack:** Next.js + Supabase · **Updated by Claude Code:** see Agent Watch in Markr toolbar

---

## Patient Report Delivery Flow

```mermaid
sequenceDiagram
    participant Doctor as Doctor / Staff
    participant Backend as Velmeni Backend
    participant Email as Patient Email
    participant Patient as Patient (Mobile)
    participant Web as Report Portal

    Doctor->>Backend: Generate report (scan / visit / CBCT)
    Backend-->>Doctor: Report ready (report_id, PDF)
    Doctor->>Backend: Send report to patient
    Backend->>Email: Summary + QR code + secure link
    Patient->>Web: Scan QR or open link
    Web->>Backend: Validate access token
    Backend->>Email: Send OTP to patient email
    Patient->>Web: Enter OTP
    Web->>Backend: Verify OTP + issue session
    Backend-->>Web: Authorized — report + scan details
    Web-->>Patient: View / download report
```

---

## Agent Responsibilities

| Agent | Role | Context limit | Triggers |
|-------|------|--------------|----------|
| `report-agent` | Generates structured report from scan data | 8k tokens | New scan uploaded |
| `delivery-agent` | Sends report email + OTP flow | 4k tokens | Doctor approves report |
| `qa-agent` | Validates report before delivery | 4k tokens | Pre-delivery hook |
| `triage-agent` | Routes urgent findings to on-call doctor | 16k tokens | Critical marker detected |
| `summary-agent` | Patient-facing plain-language summary | 8k tokens | Report finalized |

---

## Error Handling Flow

```mermaid
flowchart TD
    A[Agent call] --> B{Response OK?}
    B -- Yes --> C[Parse output]
    B -- No --> D{Retry count < 3?}
    D -- Yes --> E[Exponential backoff]
    E --> A
    D -- No --> F[Alert on-call + fallback to manual]
    C --> G{Valid schema?}
    G -- Yes --> H[Proceed]
    G -- No --> I[Log + queue for review]
```

---

## Deployment Checklist

- [x] Report agent prompt reviewed by clinical team
- [x] OTP delivery tested on staging
- [x] QA agent false-positive rate under 2%
- [ ] Load test with 1000 concurrent reports
- [ ] HIPAA compliance audit
- [ ] Patient portal mobile responsiveness

---

> [!WARNING]
> The `triage-agent` must never cache responses. Each call must be fresh to avoid stale clinical data.

> [!NOTE]
> Token counts above are averages. During peak hours, `report-agent` has consumed up to 11k tokens on complex CBCT scans.

---

## Performance Benchmarks

| Metric | Target | Current | Status |
|--------|--------|---------|--------|
| Report generation | < 8s | 5.2s | ✅ |
| OTP delivery | < 3s | 1.8s | ✅ |
| QA validation | < 2s | 3.1s | ⚠️ Needs work |
| End-to-end (patient) | < 20s | 14s | ✅ |
