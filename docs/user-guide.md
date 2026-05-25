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
- [Charts tab](#charts-tab)
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

If Samples, SQL, or Charts report that the dataset source file is unavailable, the
registered dataset points at a local file that the workspace can no longer read. Re-upload
the file, or unregister the stale dataset and register it again.

## Profiles and jobs

Profiles and quality issues are cached in **`DCC_WORKSPACE_DB_PATH`** (default
`./.dcc_workspace.duckdb` relative to the backend process cwd).

**After upload:** The UI polls background jobs until the profile is ready. Row and column
counts may appear in the dataset list before the full profile cache is written. If you call
the API directly, **`GET /api/datasets/{dataset_id}/profile`** is cache-only; on a miss
it returns **`PROFILE_NOT_READY`** with **`details.job_id`**. Poll **`GET /api/jobs/{job_id}`**
until **`completed`**, then retry.

### Large local datasets

- **Browser upload** copies files into **`.dcc_uploads/`** (up to **2 GiB** per file by default).
  Profiling runs in one background **`dataset_prepare`** job per dataset; the header and SQL schema
  panel show **Profiling…** with optional progress while it runs.
- **Files larger than 256 MiB** (configurable via **`DCC_PROFILE_HEAVY_SCAN_MAX_BYTES`**) use
  bounded sampling for per-column null rates; the profile lists a warning when metrics are
  sample-scoped. Tune **`DCC_PROFILE_TIMEOUT_SECONDS`** and **`DCC_PROFILE_LARGE_FILE_TIMEOUT_SECONDS`**
  if profiling times out on very large Parquet files.
- **Path registration** (when enabled) avoids re-copying data you already have on disk—useful when
  you analyze the same large file repeatedly. See [`backend/README.md`](../backend/README.md#uploads-and-path-registration).
- **DuckDB import** (when path registration is enabled) inspects a local **`.duckdb`**
  file and snapshots selected tables/views into app-owned Parquet copies under
  **`.dcc_uploads/`**. Imported datasets then behave like normal uploads; later changes
  to the source DuckDB file do not change the imported snapshot.

**Manual refresh:** Use **Refresh** in the dataset strip or
**`POST /api/datasets/{dataset_id}/profile/refresh`**. The UI handles job polling;
see [`backend/README.md`](../backend/README.md) for job deduplication behavior.

**Quality score:** Shown in the header and dataset list when a cached profile exists (0–100). Column flags and filters on the **Columns** tab surface per-column quality issues.

**Columns tab:** Opens by default (`/` redirects here). The table sorts by column name ascending on first load; click headers to sort by other metrics. Numeric columns show distribution stats (range, IQR, median, mean, **STDEV**) plus a compact sparkline rail.

**Structure inference (v4):** Profiles detect composite row grain keys, discrete
temporal axes, **entity identifiers** (separate from row grain), and ranked measure
candidates. Older cached profiles are invalidated on read.

**Sampling scope:** For files under the heavy-scan threshold, row/null counts are full-table.
For larger files, row counts use Parquet metadata or a bounded DuckDB count; null rates use the
structure sample. Profiles also try exact full-table
metrics for duplicate rows, column uniqueness, categorical/boolean top values, date ranges,
and inferred grain-key candidates. If those exact checks exceed the bounded profile budget,
the UI keeps the sampled value and labels it using profile metadata.

**History and diff:** Profile snapshot diff is no longer exposed in the UI; use the API if you need historical comparison.

**Saved SQL:** Snippets persist in the workspace and appear in the SQL tab and command palette.

## SQL tab

- **Run:** **⌘+Enter** (macOS) or **Ctrl+Enter**, or **Run query** / **Run selection**
  when part of the buffer is selected.
- **Format:** toolbar **Format** or **⌘+Shift+F** in the editor.
- **Save:** toolbar save icon or **⌘+S** in the editor (opens the save dialog).
- **Schema rail:** collapsed by default on the right; expand to browse the active dataset
  columns and insert identifiers. Use **Other datasets** for the rest.
- **Results grid:** Sortable columns, resizable widths, sticky **#** index, multi-cell
  selection (drag or **Shift+arrow**), **⌘/Ctrl+C** as **TSV**, **Copy JSON**,
  **Export CSV**, double-click for full cell value. Large result sets use virtualized scrolling.

## Charts tab

Use **Charts** to build customizable histograms, bar charts, scatter plots, and line charts
for the active dataset without writing SQL by hand. The tab uses the existing local
read-only query path, so chart queries stay inside the same workspace guardrails as the
SQL tab.

- **Defaults:** The builder defaults to a histogram when numeric columns are available
  (preferring columns with profile histogram metadata, 12 bins). Without numerics, it
  defaults to a bar chart when categorical columns exist, then to line when temporal
  columns exist.
- **Histogram variables and split:** Choose one numeric **Value column** and a bin count.
  Use **Split by** to render grouped histogram bars across categorical, boolean-like, or
  identifier-like values. High-cardinality split columns show a density warning.
- **Bar variables and split:** Switch **Chart type** to **Bar** to compare categories on
  the X axis. Use **Count** aggregation for row counts without a measure, or pick a numeric
  **Measure** with **Sum**, **Average**, and other aggregations. **Top N** limits the
  highest categories shown. **Split by** renders grouped bars per category.
- **Scatter variables and split:** Switch **Chart type** to **Scatter** to plot one numeric
  column against another (up to the chart row limit). Optional **Split by** colors points
  by a categorical series.
- **Line variables and split:** Switch **Chart type** to **Line** to choose one temporal X
  column and one or more numeric Y variables. Use **Split by** to render one selected Y
  variable across categorical, boolean-like, or identifier-like values.
- **Filters:** Add structured column/operator/value filters before charting. Filters support
  equality, comparisons, text contains/starts-with, comma-separated **in**, and null checks.
- **Line aggregation:** On line charts, use **Average**, **Sum**, **Minimum**, **Maximum**,
  **Median**, **Std dev**, **p25**, **p75**, **Count**, or **Count distinct** with optional
  time buckets such as day, month, quarter, or year. Choose **None** to plot raw rows
  ordered by X.
- **Scale and display:** Customize title, axis labels, Y scale, manual Y min/max, reference
  lines (line charts only), legend, smoothing, point markers, zoom slider, and whether line
  segments connect across null values. Continuous datetime buckets use a time axis;
  discrete periods such as **year** group directly by their value.
- **Run behavior:** Valid chart configurations run automatically. Data-setting changes such as
  variables, filters, split, buckets, or aggregation rerun after a short debounce. Display-only
  changes update the preview without rerunning SQL. If the result is truncated at the chart row
  limit, the preview shows a truncation warning.
- **Export and SQL:** Copy chart PNG data, CSV rows, or the chart spec JSON. Use the **SQL**
  action to open the generated read-only query in the SQL tab.

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
3. Keep the Ollama daemon running, then **`make dev`**. Open **Ask**, use **Ask settings**
   for model, row limit, and dataset scope, type a question, and send.

The backend drafts a read-only **`SELECT`/`WITH`**, runs it through the same validation
as the SQL tab, then makes a second local Ollama call by default to turn the result into
a direct concise answer. Set **`DCC_AGENT_SUMMARIZE_WITH_LLM=false`** if you prefer the
lower-latency deterministic fallback. Open generated SQL in the **SQL** tab from the turn UI.

**First visit:** With no turns in the active chat, Ask shows a centered dark workspace with a
**What should we ask?** hero. After the first question (or when you open a chat with history),
the layout switches to the thread view.

**Composer:** A rounded card stays anchored at the bottom of the Ask workspace. The send control
is on the right; **Ask settings** opens model, max preview rows, and dataset scope in one
popover. A **history** button recalls recent questions from the active chat.

**Context bar:** Above active threads, compact chips show the active model, row limit, and
dataset scope (click to jump into the matching settings section). On narrow screens, **Chats**
opens the conversation sheet.

**Per-turn actions:** Copy answer, copy markdown, regenerate, anchor (scroll link), and delete
turn. Failed streams that do not persist are kept locally so you can retry after switching chats.

**Submit / stop:** **⌘+Enter** or **Ctrl+Enter** to submit; **⌘+.** or **Esc** stops an
in-flight stream; **⌘+,** opens settings.

**Conversations:** Search by title in the Codex-style left rail; on desktop, collapse the
rail to a narrow icon strip when you want more thread space. New chats auto-title from the
first question. Rows show status (OK / Error), relative time, and dataset chips when scoped.
Prior turns are stored in the workspace (hover **(i)** on **Chats** for details).

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
| **g** then **c** / **s** / **h** / **a** / **y** | Jump to Columns / Samples / Charts / Ask / SQL |
| **r** | Refresh cached queries |
