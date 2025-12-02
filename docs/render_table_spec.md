# `render_table` Action Contract

This document defines the JSON payload that backend services and OpenAI completions must use when they want the client to show a schedule-style table. Aligning on this schema keeps the chat workflow, REST helpers (e.g., `/api/walls/summary`), and the `window.updateScheduleTable` renderer in sync.

## 1. Required envelope

Each response that should paint a schedule must include an `action` object shaped like:

```jsonc
{
  "action": "render_table",
  "table_id": "<optional stable id>",
  "title": "<human readable heading>",
  "description": "<one-line context>",
  "columns": ["Col A", "Col B", "Col C"],
  "rows": [["value", 123, "unit"], { "Col A": "Walls", "Col C": 452.3 }],
  "totals": ["합계", 999, "m³"],
  "meta": {
    "source": "metadata_csv",
    "filters": "벽, 두께 >= 200mm",
    "rowCount": 25
  }
}
```

- `action` (string, required): Must be exactly `render_table` so the chat route can dispatch it.
- `table_id` (string, optional but recommended): Deterministic identifier such as `walls_thickness_summary`. The frontend will use this later to merge/replace panels instead of stacking duplicates.
- `title` (string, optional): Defaults to `"일람표"` on the client if omitted.
- `description` (string, optional): Defaults to `"조건에 맞춰 데이터를 정리했습니다."`.
- `columns` (array<string>, required): Header labels in display order.
- `rows` (array, required): Data rows. Each row can be either an array (aligned to `columns`) or an object keyed by column name. Empty/missing rows collapse the panel to the empty state.
- `totals` (array|object, optional): Optional final row rendered with a `tfoot` once the UI supports subtotals. Until then, callers may leave it undefined.
- `meta` (object, optional): Additional context for logging/analytics (e.g., original filters, units, selected category). The frontend currently ignores it, but preserving it allows future badges/tooltips without reworking callers.

## 2. Column & row rules

1. Column names should be user-facing labels (Korean is fine) and stay under 32 characters to avoid overflow.
2. When returning objects in `rows`, missing keys are coerced to an empty string so callers do not need to pad values manually.
3. Numeric strings should already include their unit if relevant (e.g., `"3.2 m"`). Do not send raw unit-less numbers unless they are obvious counts.
4. For boolean status columns, prefer `"Y"/"N"` or localized `"예"/"아니오"` so the existing renderer can show plain text.

## 3. Fallback behavior (backend/model responsibilities)

- Always provide at least one column/row pair. If the request genuinely has no matches, still send a descriptive empty-state message via `description` and an empty `rows` array.
- If you cannot determine meaningful headers, fall back to a two-column structure: `columns = ['항목', '값']` with each row shaped like `[label, value]`. `window.updateScheduleTable` already applies this default, but callers should be explicit so downstream logs reflect the intended data.
- When the model produces multiple logical tables (e.g., detail list + grouped summary), send them as sequential `render_table` actions ordered by priority. The frontend will render each one as it arrives until we add multi-table panes.

## 4. Table identifiers

Use predictable `table_id` patterns to keep deduplication simple:

| Scenario                  | Suggested `table_id`               |
| ------------------------- | ---------------------------------- |
| Wall thickness breakdown  | `walls_thickness_summary`          |
| Element category counts   | `elements_category_counts`         |
| Custom user filter result | `custom_schedule_<hash-of-filter>` |

When `table_id` matches an existing panel the UI should treat the new payload as a replacement (future work). Until that logic lands, emitting `table_id` is still valuable for telemetry and manual debugging.

## 5. Validation checklist for implementers

- [ ] `action` equals `render_table`.
- [ ] `columns.length >= 1`.
- [ ] Every row is either an array with the same length as `columns` or an object.
- [ ] Titles/descriptions trimmed of excess whitespace.
- [ ] Sensitive values (e.g., raw file paths) stripped before sending to the browser.

Following this spec ensures that the OpenAI tool definition, `routes/chat.js`, and `wwwroot/assistant-frontend.js` all speak the same language when delivering schedule data to the viewer.
