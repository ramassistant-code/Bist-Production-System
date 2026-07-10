---
name: Products and Components Supabase schema mapping
description: Actual DB column names verified via service-role REST API. Differ from user spec naming.
---

## Products table (`products`)
| User spec concept | Actual DB column |
|---|---|
| שם מוצר | `name` |
| תיאור מוצר | `product_explanation` |
| מחיר מכירה | `consumer_price` |
| הערות פנימיות | `sales_notes` |
| סטטוס פעיל | `is_active` (boolean) |
| מספר מוצר (auto) | `product_number` (via make_business_number trigger) |
| סוג תוצר | `deliverable_type` |

Also has: `bulk_price`, `production_cost`, `min_profit`, `portfolio_link`, `quote_description_default`, `quote_notes_default`, `monday_*`, `deleted_at`.

## Components table (`components`)
| User spec concept | Actual DB column |
|---|---|
| שם רכיב | `name` |
| יחידת חישוב | `deliverable` (repurposed text field — no unit_type column exists) |
| עלות ליחידה | `cost` |
| הערות פנימיות | `internal_notes` |
| סטטוס פעיל | `is_active` (boolean) |
| מספר רכיב (auto) | `component_number` (via make_business_number trigger) |

Also has: `sop_link`, `coordination_owner`, `default_price`, `quote_description_default`, `quote_notes_default`, `monday_*`, `deleted_at`.

**No `unit_type` column** — the `deliverable` field is used instead.

## Product Components table (`product_components`)
| User spec concept | Actual DB column |
|---|---|
| כמות | `default_quantity` |
| עלות ליחידה (snapshot) | `default_unit_price` |
| עלות כוללת | `total_cost` (stored, = qty × unit_price) |

Also has: `component_cost`, `include_in_quote_total_default`, `sort_order`, `monday_*`, `deleted_at`.

**No `notes` column** in product_components.
