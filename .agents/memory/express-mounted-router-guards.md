---
name: Express mounted router guards
description: Prevent route-level authorization middleware from blocking unrelated sibling routers.
---

Authorization middleware inside a router that is later mounted beside other routers must be scoped to that router's URL prefix, not installed at the router root.

**Why:** A root-level `router.use(...)` runs for every request entering that mounted router, even when none of its routes match. If that router is mounted before siblings, it can return 403 before requests reach unrelated routes.

**How to apply:** In feature routers with shared parent mounting, use a path-scoped guard such as `router.use("/feature-prefix", guard)` or attach the guard to each route.