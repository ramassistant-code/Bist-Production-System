---
name: pino logger pattern
description: Correct pino logger call pattern for Express route error logging; wrong pattern causes TypeScript overload mismatch.
---

# Pino Logger Pattern

## Rule
Always use object-first format:
```ts
logger.error({ err }, "message describing the operation");
```

**Why:** Pino's TypeScript overloads require the first argument to be an object when passing an error. Using `logger.error("string", err)` where `err` is `unknown` fails typecheck because the second overload expects `undefined` as second arg when first arg is a string literal.

## How to apply
In every Express route catch block:
```ts
} catch (err) {
  logger.error({ err }, "GET /deals error");
  ...
}
```

Not:
```ts
logger.error("GET /deals error:", err); // ❌ fails typecheck with unknown err
```
