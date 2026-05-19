# User Guide

How to use Data Control Center day to day. For install and first run, see the root
[`README.md`](../README.md) and [**5-minute tour**](5-minute-tour.md). For HTTP
request/response shapes and **`DCC_*`** settings, see
[`backend/README.md`](../backend/README.md) and OpenAPI at
**`http://127.0.0.1:8000/docs`** when the backend is running.

## Table of contents

- [Getting data in](#getting-data-in)
- [Profiles and jobs](#profiles-and-jobs)
- [SQL tab](#sql-tab)
- [Ask tab](#ask-tab)
- [Keyboard shortcuts](#keyboard-shortcuts)

## Getting data in

Evaluate the app without private data using the synthetic fixtures in
[`examples/`](../examples/) and the [five-minute tour](5-minute-tour.md).

**Upload (default):** In the web UI, drag-and-drop or select files, or use **Choose folder**
to upload all supported files in a directory at once. The API stores copies under
**`.dcc_uploads/`** (relative to the backend cwd unless overridden), validates them,
then registers them. Upload limits are configured with **`DCC_UPLOAD_*`** variables (see
[`backend/README.md`](../backend/README.md#uploads-and-path-registration)).

**Path registration (advanced):** Registering absolute file or folder paths is
disabled by default. Enable **`DCC_ENABLE_PATH_REGISTRATION=true`** only for trusted
local workflows and keep **`DCC_REGISTRATION_ALLOWED_ROOTS`** narrow.

**View names:** DuckDB creates one internal **view per dataset** from the file stem
(e.g. `orders.parquet` → `orders`). Duplicate stems get suffixes such as
`orders_ds_002`; reserved SQL-like names get a `_dcc` suffix. The dataset sidebar and
**`GET /api/datasets`** show **`view_name`** for each dataset. Ad-hoc SQL must reference
at least one registered view when datasets exist.

**Unregister:** Use the sidebar trash action or **`DELETE /api/datasets/{dataset_id}`**.
This drops the DuckDB view, clears cached profile state, and deletes app-owned upload
copies. Externally registered source files are never deleted.

## Profiles and jobs

Profiles and quality issues are cached in **`DCC_WORKSPACE_DB_PATH`** (default
`./.dcc_workspace.duckdb` relative to the backend process cwd).

**After upload:** The UI polls background jobs until the profile is ready. If you call
the API directly, **`GET /api/datasets/{dataset_id}/profile`** is cache-only; on a miss
it returns **`PROFILE_NOT_READY`** with **`details.job_id`**. Poll **`GET /api/jobs/{job_id}`**
until **`completed`**, then retry.

**Manual refresh:** Use **Refresh** in the dataset strip or
**`POST /api/datasets/{dataset_id}/profile/refresh`**. The UI handles job polling;
see [`backend/README.md`](../backend/README.md) for job deduplication behavior.

**Quality score:** Shown on Overview and in the dataset list when a cached profile exists (0–100).
When only one profile snapshot exists, the quality card notes **No prior snapshot** instead of a trend delta.

**Overview completeness:** The **Completeness** card shows populated vs missing cell %, estimated missing/duplicate counts, summary chips (columns with nulls), a compact top-5 null chart (click a bar to open the column), and links to **View flagged columns** (Columns tab, critical flags) and **All quality issues**. A full top-8 null ranking remains under **Quality focus**.

**Profile summary:** When the profiler provides a narrative, Overview shows it under the hero metrics (expandable if long).

**Structure inference (v4):** Profiles detect composite row grain keys, discrete
temporal axes, **entity identifiers** (separate from row grain), and ranked measure
candidates. The **Overview → Structure** card labels **Entities**, grain columns, and
**Row grain** separately. Older cached profiles are invalidated on read.

**Sampling scope:** Row/null counts are full-table. Profiles also try exact full-table
metrics for duplicate rows, column uniqueness, categorical/boolean top values, date ranges,
and inferred grain-key candidates. If those exact checks exceed the bounded profile budget,
the UI keeps the sampled value and labels it using profile metadata.

**History and diff:** Available from Overview when multiple profile snapshots exist.

**Saved SQL:** Snippets persist in the workspace and appear in the SQL tab and command palette.

## SQL tab

- **Run:** **⌘+Enter** (macOS) or **Ctrl+Enter**, or **Run query**.
- **Results grid:** Sortable columns, resizable widths, sticky **#** index, multi-cell
  selection (drag or **Shift+arrow**), **⌘/Ctrl+C** as **TSV**, **Copy JSON**,
  **Export CSV**, double-click for full cell value. Large result sets use virtualized scrolling.

## Ask tab

Optional local LLM assistant via [Ollama](https://ollama.com).

**Setup:**

1. Install Ollama (e.g. `brew install ollama` on macOS).
2. Pull a model (default **`qwen3:4b`**):

   ```bash
   ollama pull qwen3:4b
   ```

   For a different default, set **`DCC_LLM_MODEL`** when starting the backend (see
   [`backend/README.md`](../backend/README.md#local-llm-ask)). Pulling models remains a
   manual Ollama step; the app only lists models already installed locally.
3. Keep the Ollama daemon running, then **`make dev`**. Open **Ask**, choose any installed
   model from the **Ollama model** picker, type a question, and optional **max_rows** for
   the result preview.

The backend drafts a read-only **`SELECT`/`WITH`**, runs it through the same validation
as the SQL tab, and returns a concise answer. Open generated SQL in the **SQL** tab from
the turn UI.

**Submit / stop:** **⌘+Enter** or **Ctrl+Enter** to submit; **Esc** stops an in-flight stream.

**Conversations:** Prior turns are stored in the workspace and can be resumed from the
Ask sidebar.

**HTTP API:** **`GET /api/llm/models`** lists locally installed Ollama models.
**`POST /api/agent/ask/stream`** accepts an optional **`model`** field (defaults to
**`DCC_LLM_MODEL`**). For streaming event types and all **`DCC_LLM_*`** /
**`DCC_AGENT_*`** settings, see [`backend/README.md`](../backend/README.md#local-llm-ask)
and OpenAPI.

**Health:** **`GET /api/health`** includes an **`llm`** reachability probe for the
configured Ollama endpoint.

**API access from scripts:** Protected routes may require **`X-DCC-Local-Token`**. Obtain
a token via **`GET /api/local-session`** or pin **`DCC_LOCAL_API_TOKEN`** — see
[`backend/README.md`](../backend/README.md#local-only-security) and [`SECURITY.md`](../SECURITY.md).

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| **⌘/Ctrl+K** | Command palette |
| **?** | Shortcuts sheet |
| **/** | Focus dataset search |
| **g** then **o** / **c** / **q** / **s** / **a** / **y** | Jump to Overview / Columns / Quality / Samples / Ask / SQL |
| **r** | Refresh cached queries |
