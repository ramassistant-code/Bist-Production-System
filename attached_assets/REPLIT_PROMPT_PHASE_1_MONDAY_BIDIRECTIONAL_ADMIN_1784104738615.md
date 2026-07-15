# Replit Prompt — Phase 1: Monday Bidirectional Sync Administration UI

## Task

Update the existing BIST Production System administration interface to support the new Monday ↔ Supabase bidirectional synchronization configuration.

This is Phase 1 only.

The purpose of this phase is to build the administration foundation:

1. Manage Monday synchronization targets.
2. Manage field mappings for both directions.
3. Display basic polling and synchronization health.
4. Prevent unsafe activation of incomplete or Production configurations.

Do not implement the synchronization engine inside Replit. CodeWords will remain responsible for all Monday API communication, polling, retries, mapping execution, conflict processing and synchronization logic.

## Mandatory first step: inspect before changing code

Before implementing anything:

1. Inspect the current project structure and existing Monday administration screens.
2. Inspect the actual Supabase schema using the configured server-side connection.
3. Verify the real columns and relationships of these existing tables:

```text
monday_export_targets
monday_export_field_mappings
monday_export_runs
monday_export_run_steps
monday_export_run_items
monday_entity_links
monday_export_run_logs
```

4. Verify whether the following new objects exist:

```text
monday_sync_polling_state
monday_sync_events
monday_sync_outbox
monday_sync_conflicts
monday_sync_health_overview
```

5. Verify that the new bidirectional columns exist on:

```text
monday_export_targets
monday_export_field_mappings
monday_entity_links
```

Do not assume column names, primary-key types, foreign keys or existing UI structure. If the schema differs from the requirements below, stop before destructive changes and report the exact mismatch.

Do not create, rename, delete or alter database tables in this task. The Supabase migration is managed separately.

## Existing application rules

Preserve the existing application architecture, authentication, authorization, routing, design system and coding conventions.

Mandatory UI rules:

- Entire interface in Hebrew.
- Full RTL layout.
- Clear, professional, wide desktop layout.
- Responsive behavior for smaller screens.
- Do not create a long single-column page.
- Prefer tabs, cards, tables, drawers and focused dialogs.
- Reuse existing components and styles.
- Do not duplicate navigation or create a second administration system.
- Preserve all currently working Monday export screens and actions unless explicitly changed below.

## Scope boundaries

### Replit is responsible for

- Reading and displaying sync configuration from Supabase.
- Creating and editing target configuration.
- Creating and editing field mappings.
- Client-side and server-side validation.
- Displaying polling state and basic health information.
- Displaying clear warnings and activation blockers.
- Recording configuration changes through secure server-side application routes.

### Replit is not responsible for

- Calling the Monday API directly.
- Polling Monday.
- Running mapping transformations.
- Updating Monday items.
- Applying inbound Monday changes to business tables.
- Implementing retry, lease, deduplication or loop-prevention logic.
- Resolving synchronization conflicts in this phase.
- Processing the outbox in this phase.
- Creating Supabase triggers for synchronization.

Do not expose Supabase service-role credentials, CodeWords secrets or Monday API tokens to the browser.

## Navigation

Use the existing administration navigation. Update or add one main section named:

```text
סנכרון Monday
```

Inside it, implement these Phase 1 tabs:

```text
יעדי סנכרון
מיפוי שדות
ניטור Polling
```

If existing tabs already cover some of these areas, extend them instead of creating duplicates.

Do not implement the advanced `אירועים`, `התנגשויות` or `תור יוצא` management screens in this phase. They will be implemented later.

## Tab 1: יעדי סנכרון

Build a clear table based on `monday_export_targets`.

### Table columns

Display:

- שם היעד.
- מפתח יעד.
- סוג ישות.
- סביבת עבודה.
- מזהה לוח Monday.
- שם לוח צפוי.
- יעד פעיל.
- Supabase → Monday.
- Monday → Supabase.
- תדירות Polling.
- מצב הגדרה.
- פעולות.

Use clear visual badges for:

```text
לא מוגדר
מוגדר חלקית
מוכן לבדיקה
פעיל
חסום
שגיאה
```

The status shown in the UI must be derived safely from configuration and polling health. Do not add a new database status column unless it already exists.

### Target edit drawer/dialog

When editing a target, support these fields using the actual database columns:

```text
target_name
target_key
entity_type
monday_board_id
board_name_expected
environment
is_active
inbound_enabled
outbound_enabled
polling_interval_seconds
polling_overlap_seconds
allow_inbound_create
inbound_create_policy
inbound_missing_link_policy
allow_inbound_archive
allow_inbound_delete
settings
```

Do not expose raw `settings` JSON as the primary editing experience. Only show it in an advanced collapsed section if the existing application already supports safe JSON editing and validation.

### Hebrew field labels

Use these labels:

| Database field | Hebrew label |
|---|---|
| `target_name` | שם היעד |
| `target_key` | מפתח היעד |
| `entity_type` | סוג ישות |
| `monday_board_id` | מזהה לוח Monday |
| `board_name_expected` | שם הלוח הצפוי |
| `environment` | סביבת עבודה |
| `is_active` | יעד פעיל |
| `outbound_enabled` | סנכרון מ־Supabase ל־Monday |
| `inbound_enabled` | סנכרון מ־Monday ל־Supabase |
| `polling_interval_seconds` | תדירות בדיקה בשניות |
| `polling_overlap_seconds` | חפיפה בין סריקות בשניות |
| `allow_inbound_create` | אפשר יצירת רשומות מ־Monday |
| `inbound_create_policy` | מדיניות יצירת רשומות |
| `inbound_missing_link_policy` | טיפול בפריט Monday לא מקושר |
| `allow_inbound_archive` | אפשר ארכוב מ־Monday |
| `allow_inbound_delete` | אפשר מחיקה מ־Monday |

### Select values and Hebrew display

Environment:

```text
test → בדיקות
production → ייצור
```

Inbound create policy:

```text
reject → חסום
review → העבר לבדיקה
create → צור אוטומטית
```

Missing-link policy:

```text
ignore → התעלם
review → העבר לבדיקה
create → צור רשומה
```

Store only the English enum values in Supabase. Display Hebrew labels in the UI.

### Safety defaults

When creating a target, default to:

```text
environment = test
is_active = false
inbound_enabled = false
outbound_enabled = false
polling_interval_seconds = 120
polling_overlap_seconds = 300
allow_inbound_create = false
inbound_create_policy = reject
inbound_missing_link_policy = review
allow_inbound_archive = false
allow_inbound_delete = false
```

### Activation blockers

The UI and server route must reject activation when any of these conditions exists:

- `monday_board_id` is empty.
- `monday_board_id` equals `CONFIGURE_BOARD_ID`.
- `board_name_expected` is empty.
- Environment is `test` and `board_name_expected` does not begin with `TEST |`.
- No active field mappings exist for the target.
- `inbound_enabled=true` but no inbound or bidirectional mappings exist.
- `outbound_enabled=true` but no outbound or bidirectional mappings exist.
- Inbound creation is enabled while the create policy remains `reject`.
- Inbound delete is enabled for protected entity types: deal, payment or immutable quote-related entities.

Show all blockers together in a clear Hebrew validation panel. Do not silently change user selections.

Because Replit must not call Monday directly, label this validation in Phase 1 as:

```text
בדיקת מוכנות מקומית
```

Do not claim that the Monday board or columns were verified remotely. A CodeWords-powered remote test will be added later.

## Tab 2: מיפוי שדות

Build a target selector at the top. After selecting a target, display its mappings from `monday_export_field_mappings` in a wide table.

### Mapping table columns

Display:

- סדר.
- שדה Supabase.
- עמודת Monday.
- סוג עמודת Monday, if stored in the existing schema.
- כיוון הסנכרון.
- בעלות על השדה.
- מדיניות התנגשות.
- Transformation נכנס.
- Transformation יוצא.
- ערכים ריקים.
- שדה רגיש.
- פעיל.
- פעולות.

Use the actual existing source-field and Monday-column field names discovered in the schema. Do not invent replacements when equivalent columns already exist.

### Mapping editor

Support all existing mapping fields and these new fields:

```text
sync_direction
field_authority
conflict_policy
inbound_transform_type
inbound_transform_config
outbound_transform_type
outbound_transform_config
allow_null_inbound
allow_null_outbound
inbound_validation
is_sensitive
```

Preserve existing mapping fields such as source path, Monday column ID, order, active state and existing transform configuration.

### Direction labels

```text
supabase_to_monday → Supabase → Monday
monday_to_supabase → Monday → Supabase
bidirectional → דו־כיווני
disabled → כבוי
```

### Authority labels

```text
supabase → Supabase
monday → Monday
shared → משותפת
manual → הכרעה ידנית
```

### Conflict-policy labels

```text
authority_wins → הצד הבעלים מנצח
supabase_wins → Supabase מנצח
monday_wins → Monday מנצח
latest_wins → העדכון האחרון מנצח
manual → הכרעה ידנית
```

### Mapping validation

Validate on both client and server:

- Supabase field/source path is required.
- Monday column ID is required.
- Direction, authority and conflict policy must be valid enums.
- Bidirectional mappings must define authority and conflict policy.
- A Monday-authoritative field cannot use `supabase_wins` without an explicit warning and confirmation.
- A Supabase-authoritative field cannot use `monday_wins` without an explicit warning and confirmation.
- Manual authority should default to manual conflict policy.
- `latest_wins` must show a strong warning.
- Protected/financial fields must not use `latest_wins`.
- Unknown transformation types must be rejected.
- Transform configuration must be valid JSON when required.

Supported transformation choices in this UI:

```text
identity
text
integer
decimal
boolean
date
datetime
status_label_to_value
status_value_to_label
person_id_to_user_id
user_id_to_person_id
json_path
enum_map
phone_normalize
email_normalize
```

Use human-readable Hebrew labels and retain the English code as the stored value.

### Protected fields

Do not hardcode only one exact database schema. Add a small centralized configuration in the application for protected field patterns and entity types.

At minimum, warn/block unsafe inbound or latest-wins configuration for fields associated with:

```text
approved quote snapshots
deal snapshots
locked versions
financial totals
payment amounts
prices
VAT totals
immutable identifiers
```

If the current project already has metadata describing immutable fields, use it instead of duplicating the rules.

## Tab 3: ניטור Polling

Implement a read-only Phase 1 monitoring screen using `monday_sync_health_overview` and, when needed, `monday_sync_polling_state`.

Do not add buttons that pretend to run CodeWords if no secured CodeWords endpoint exists yet.

### Summary cards

Display:

- יעדים פעילים.
- יעדים עם Polling פעיל.
- אירועים ממתינים.
- אירועים שנכשלו.
- התנגשויות פתוחות.

### Health table

Display:

- יעד.
- סביבה.
- לוח Monday.
- מצב Polling.
- סריקה אחרונה.
- סנכרון מוצלח אחרון.
- סריקה הבאה.
- כישלונות רצופים.
- אירועים ממתינים.
- אירועים שנכשלו.
- התנגשויות פתוחות.
- שגיאה אחרונה.

Translate statuses:

```text
idle → ממתין
running → פועל כעת
waiting → בהמתנה
failed → נכשל
disabled → כבוי
```

Use automatic refresh with a reasonable interval such as 30 seconds, plus a manual `רענן` button. Stop automatic refresh when the browser tab is hidden if the existing frontend utilities support it.

If the monitoring view does not exist, show an administrator-only setup warning. Do not crash the page and do not create the view from application code.

## Server-side data access

Follow the existing project server/API architecture.

Requirements:

- All mutations must pass through authenticated server-side handlers.
- Require the existing administrator permission/role.
- Never write directly from an untrusted browser using a service-role key.
- Validate enum values and activation rules on the server, even if the client already validates them.
- Use parameterized Supabase queries.
- Return safe Hebrew error messages to the UI.
- Log configuration changes using the existing audit mechanism if one exists.
- Do not log secrets or sensitive mapping values.
- Do not weaken existing RLS or authentication policies.

If the project already uses Supabase browser access protected by RLS for administration, preserve that pattern only when the policies are verified to restrict these operations correctly. Do not introduce the service-role key into frontend code.

## UX requirements

- Use a wide content container suitable for mapping tables.
- Keep filters and target selection sticky where useful.
- Use searchable selects for targets and fields when lists are long.
- Use drawers/dialogs for editing instead of navigating away from the list.
- Clearly separate TEST and Production with color and labels.
- Production controls must show an extra warning.
- Destructive or high-risk options must require confirmation.
- Disable Save while a request is in progress.
- Prevent double submissions.
- Show success and error feedback in Hebrew.
- Preserve unsaved form state when a validation error occurs.
- Do not expose raw database errors to users.

## Empty, loading and error states

Implement proper states for:

- Loading.
- No targets.
- No mappings for selected target.
- Monitoring migration missing.
- Permission denied.
- Supabase unavailable.
- Partial data failure.

Every empty state must explain the next action in Hebrew.

## Tests required in Phase 1

Add tests consistent with the existing project test framework.

Test at least:

1. Existing targets load correctly.
2. Target can be edited without changing unrelated fields.
3. `CONFIGURE_BOARD_ID` cannot be activated.
4. TEST target with a non-TEST expected board name cannot be activated.
5. Inbound sync cannot be activated without an inbound/bidirectional mapping.
6. Outbound sync cannot be activated without an outbound/bidirectional mapping.
7. Default target configuration is safe and disabled.
8. Mapping direction/authority/conflict enums are stored correctly.
9. Invalid transformation type is rejected.
10. Protected financial mapping rejects `latest_wins`.
11. Non-admin user cannot edit configuration.
12. Monitoring screen renders all polling statuses correctly.
13. Sensitive mapping configuration is not leaked into logs.
14. Existing manual Supabase → Monday run screens still work.

## Do not do in Phase 1

- Do not call Monday from Replit.
- Do not create Monday webhooks.
- Do not implement polling.
- Do not implement CodeWords workflows.
- Do not process `monday_sync_outbox`.
- Do not add automatic synchronization triggers.
- Do not build conflict resolution actions.
- Do not build retry/resume actions for polling events.
- Do not modify business tables.
- Do not enable any synchronization target automatically.
- Do not perform a broad UI redesign unrelated to Monday administration.
- Do not remove or rename existing database objects.

## Deliverables

After implementation, report:

1. Files created or changed.
2. Existing components/routes reused.
3. Exact Supabase tables and columns used.
4. Any schema mismatches found.
5. Activation rules implemented.
6. Tests added and their results.
7. Items intentionally deferred to Phase 2.
8. Manual verification checklist.

## Definition of done

Phase 1 is complete only when:

- Administrators can configure both sync directions per target.
- Administrators can configure direction, ownership and conflict policy per field.
- Incomplete or unsafe targets cannot be activated.
- Polling health is visible in a read-only monitoring tab.
- All UI is Hebrew and full RTL.
- No secret is exposed to the browser.
- Replit performs no direct Monday API calls.
- Existing export/run functionality remains operational.
- No synchronization target was enabled automatically.
- Tests pass and no unrelated features were changed.

Begin by inspecting the actual code and schema. Present a brief implementation plan and identified schema matches/mismatches before editing. Then implement Phase 1 only.
