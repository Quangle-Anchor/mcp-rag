# MAIA Reference Cheat Sheets — Lazy Read Index

These files are best-practice references copied from MAIA (Mendix's
official AI). They are **not** part of the always-loaded spec set.
Read each one only when you are about to perform the matching action,
and **at most once per session per file**.

## Trigger table

| About to do this | Read this file | Lines |
|---|---|---|
| Plan or emit `create_microflow` (or modify activities/flows in an existing one) | [`microflow-commons.md`](./microflow-commons.md) | 248 |
| Author any microflow expression (decision condition, `change variable` value, custom return, calculated attribute) | [`microflow-expressions.md`](./microflow-expressions.md) | 402 |
| Author any XPath constraint (retrieve activity, entity access rule, datasource filter) | [`microflow-xpath.md`](./microflow-xpath.md) | 289 |
| Plan or emit `create_page`, `create_form_page`, or `add_widget` | [`page-creation.md`](./page-creation.md) | 1936 |
| About to call `microflow_arrange`, set explicit `branch` overrides on flows in `create_microflow`, or diagnose a microflow canvas whose layout came out wrong | [`microflow-layout.md`](./microflow-layout.md) | 304 |

## Loading rules

- **Lazy.** Do not load any of these files into a system prompt, an
  agent definition, or a bulk read at session start.
- **On demand.** Read the matching file at the moment you decide to
  perform the triggering action, before emitting the MCP call.
- **Once per session per file.** After the first Read, keep the
  content in working memory. Do not re-read.
- **Don't bundle.** Never Read more than one of these files in a
  single batched Read call. Each Read must be justified by its own
  trigger.
- **Stays out of `specs_index.md`.** This directory is intentionally
  absent from the main per-tool spec index — these files are looked
  up by trigger, not by ordinal read order.

## When NOT to read

- Pure domain-model work (entities, attributes, enums, associations).
- Pure module / working-copy / commit operations.
- Read-only inspection of an existing microflow or page
  (`read_microflow_details`, `read_page_details`).
- Any phase where the agent is parsing inputs or building a plan but
  has not yet committed to authoring the matching artifact.

## Adding a new reference

1. Place the file alongside the existing ones; pick a slug that
   matches the trigger (e.g. `nanoflow-commons.md`, `rest-consumer.md`).
2. Add a row to the trigger table above with the precise action that
   fires it and the line count.
3. Add a matching row to the implementer agent's
   "Reference Loading Protocol" subsection so the lazy-Read behavior
   extends to the new file.
4. Do NOT add the file to `specs_index.md` — references stay out of
   the main index by design.
