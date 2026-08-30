---
name: CRM RoundRobin lock exhaustion
description: Distinguishes a genuinely empty CRM assignment queue from temporary SKIP LOCKED exhaustion during concurrent intake.
---

When CRM intake calls the database RoundRobin function and receives `null`, do not immediately assume there are no active representatives. Check whether an active queue still exists; if it does, briefly retry the same database function before using the manager/admin fallback.

**Why:** The database function uses `FOR UPDATE SKIP LOCKED`. During concurrent intake, every active availability row can be locked for a few milliseconds, causing a transient `null` even though active representatives exist. Immediate fallback overloads managers during bursts.

**How to apply:** Keep queue ordering and counter mutation inside the database function. Retry that function only when an active queue exists; use fallback immediately when the active queue is genuinely empty.