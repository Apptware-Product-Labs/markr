# Markr Feature Showcase

Use this file to verify Markr rendering coverage for architecture diagrams, sequence diagrams, release timelines, GitHub alerts, and syntax highlighting.

## Mermaid Flowchart

The Strangler Fig architecture keeps the monolith running while new services receive traffic incrementally.

```mermaid
flowchart TD
    Client([Client]) --> Gateway[API Gateway]
    Gateway -->|/orders/*| OrderSvc[Order Service<br/>new]
    Gateway -->|/payments/*| PaySvc[Payment Service<br/>new]
    Gateway -->|/legacy/*| Monolith[Legacy Monolith<br/>still running]
    OrderSvc --> OrderDB[(Orders DB<br/>PostgreSQL)]
    PaySvc --> PayDB[(Payments DB<br/>PostgreSQL)]
    Monolith --> LegacyDB[(Legacy DB<br/>MySQL)]

    style OrderSvc fill:#22c55e,color:#fff,stroke:none
    style PaySvc fill:#22c55e,color:#fff,stroke:none
    style Monolith fill:#f97316,color:#fff,stroke:none
    style Gateway fill:#3b82f6,color:#fff,stroke:none
```

## Mermaid Sequence

Order flow between the client, gateway, services, and Kafka.

```mermaid
sequenceDiagram
    autonumber
    participant Client
    participant Gateway as API Gateway
    participant Orders as Order Service
    participant Payments as Payment Service
    participant Kafka

    Client->>Gateway: POST /orders
    Gateway->>Orders: Create order
    Orders->>Kafka: publish OrderCreated
    Kafka-->>Payments: consume OrderCreated
    Payments->>Payments: authorize payment
    Payments->>Kafka: publish PaymentAuthorized
    Kafka-->>Orders: consume PaymentAuthorized
    Orders-->>Gateway: order confirmed
    Gateway-->>Client: 201 Created
```

## Mermaid Gantt

Sprint 12 release timeline with colour-coded phases.

```mermaid
gantt
    title Sprint 12 Release Timeline
    dateFormat  YYYY-MM-DD
    axisFormat  %b %d

    section Discovery
    Architecture review        :disc1, 2026-05-20, 2d
    Contract mapping           :disc2, after disc1, 2d

    section Build
    Order service routing      :build1, 2026-05-24, 3d
    Payment event bridge       :build2, 2026-05-25, 3d

    section Validation
    Load and rollback tests    :test1, 2026-05-28, 2d
    Release candidate          :crit, rc, 2026-05-30, 0d

    section Launch
    Gradual traffic shift      :launch1, 2026-05-31, 3d
    Production review          :review, after launch1, 1d
```

## GitHub Alerts

> [!NOTE]
> Keep the monolith as the source of truth until the new service owns the full workflow.

> [!TIP]
> Route one endpoint family at a time and keep rollback paths simple.

> [!WARNING]
> Do not split the database before ownership boundaries are clear.

> [!IMPORTANT]
> Every new service should publish integration events before traffic is shifted.

> [!CAUTION]
> Avoid a dual-write release unless the failure and replay plan is tested.

## Syntax Highlighting

### TypeScript rateLimitMiddleware

```typescript
import type { Request, Response, NextFunction } from "express";

const hits = new Map<string, { count: number; resetAt: number }>();

export function rateLimitMiddleware(limit = 120, windowMs = 60_000) {
  return function rateLimit(req: Request, res: Response, next: NextFunction) {
    const key = req.ip ?? "anonymous";
    const now = Date.now();
    const bucket = hits.get(key);

    if (!bucket || bucket.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (bucket.count >= limit) {
      res.setHeader("Retry-After", Math.ceil((bucket.resetAt - now) / 1000));
      return res.status(429).json({ error: "rate_limited" });
    }

    bucket.count += 1;
    return next();
  };
}
```

### SQL CQRS Read Model

```sql
CREATE MATERIALIZED VIEW order_summary AS
SELECT
  o.id AS order_id,
  o.customer_id,
  o.status,
  COALESCE(SUM(i.quantity * i.unit_price), 0) AS gross_total,
  MAX(e.created_at) AS last_event_at
FROM orders o
LEFT JOIN order_items i ON i.order_id = o.id
LEFT JOIN order_events e ON e.order_id = o.id
GROUP BY o.id, o.customer_id, o.status;

CREATE UNIQUE INDEX order_summary_order_id_idx
  ON order_summary (order_id);
```
