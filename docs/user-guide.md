# User Guide

How to use Data Control Center day to day. For install and first run, see the root
[`README.md`](../README.md) and [`5-minute-tour.md`](5-minute-tour.md). For HTTP
request/response shapes, use OpenAPI at **`http://127.0.0.1:8000/docs`** when the
backend is running.

## Table of contents

- [Getting data in](#getting-data-in)
- [Profiles and jobs](#profiles-and-jobs)
- [SQL tab](#sql-tab)
- [Ask tab](#ask-tab)
- [Keyboard shortcuts](#keyboard-shortcuts)

## Getting data in

Evaluate the app without private data using the synthetic fixtures in
[`examples/`](../examples/) and the [five-minute tour](5-minute-tour.md).

**Upload (default):** In the web UI, drag-and-drop or select files. The API stores
copies under **`.dcc_uploads/`** (relative to the backend cwd unless overridden),
validates them, then registers them. Tune limits with **`DCC_UPLOAD_MAX_BYTES_PER_FILE`**
(default 256 MiB), **`DCC_UPLOAD_MAX_BATCH_BYTES`**, and
**`DCC_UPLOAD_MAX_FILES_PER_BATCH`** (see [`backend/README.md`](../backend/README.md)).

**Path registration (advanced):** Registering absolute file or folder paths is
disabled by default. Enable **`DCC_ENABLE_PATH_REGISTRATION=true`** only for trusted
local workflows and keep **`DCC_REGISTRATION_ALLOWED_ROOTS`** narrow.

**View names:** DuckDB creates one internal **view per dataset** from the file stem
(e.g. `orders.parquet` → `orders`). Duplicate stems get suffixes such as
`orders_ds_002`; reserved SQL-like names get a `_dcc` suffix. **`GET /api/datasets`**
includes **`view_name`** on each summary. Ad-hoc SQL must reference at least one
registered view when datasets exist.

**Unregister:** Use the sidebar trash action or **`DELETE /api/datasets/{dataset_id}`**.
This drops the DuckDB view, clears cached profile state, and deletes app-owned upload
copies. Externally registered source files are never deleted.

## Profiles and jobs

Profiles and quality issues are cached in **`DCC_WORKSPACE_DB_PATH`** (default
`./.dcc_workspace.duckdb` relative to the backend process cwd).

**Upload and path registration** queue a **row-count** job and a **profile refresh**
job. **`GET /api/datasets/{dataset_id}/profile`** is **cache-only**: on a miss it
returns **404** with **`PROFILE_NOT_READY`** and **`details.job_id`**. Poll
**`GET /api/jobs/{job_id}`** until **`completed`**, then retry the profile GET. The UI
uses **`useDatasetProfile`** / **`api.fetchDatasetProfile`** for this flow.

**Manual refresh:** **`POST /api/datasets/{dataset_id}/profile/refresh`** queues a job
(deduped when one is already **queued** or **running**) and returns
**`{ job_id, status: "queued" }`**. Poll **`GET /api/jobs/{job_id}`** or list
**`GET /api/jobs`**.

**Quality score:** **`GET /api/datasets`** may include **`quality_score`** (0–100) when
a cached profile exists.

**Structure inference (v4):** Profiles detect composite row grain keys, discrete
temporal axes, **entity identifiers** (separate from row grain), and ranked measure
candidates. Cached profiles use **`structure_version: "v4"`**; older cache entries are
invalidated on read. The **Overview → Structure** card labels **Entities**, grain
columns, and **Row grain** separately.

**Sampling scope:** Row/null counts are full-table; high-cardinality metrics (uniqueness,
cardinality, top values, histograms, duplicate-row %, grain-key inference) include
**`metric_scope`**, **`duplicate_row_pct_scope`**, and **`grain_key_scope`** metadata.
The UI labels sampled metrics using **`profiler_sample_rows`**.

**Sample rows:** **`GET /api/datasets/{dataset_id}/sample`** returns structured error
codes (e.g. **`SQL_TIMEOUT`**, **`NOT_FOUND`**) without leaking paths. Responses include
**`total_rows`** before **`LIMIT`/`OFFSET`** (from stored **`row_count`** or a bounded
**`COUNT(*)`**).

**History and diff:** **`GET /api/datasets/{dataset_id}/profile/history`** lists
snapshots; **`GET /api/datasets/{dataset_id}/profile/diff`** compares the latest two.

**Saved SQL:** Snippets persist via **`/api/saved-queries`** and appear in the SQL tab
and command palette.

## SQL tab

- **Run:** **⌘+Enter** (macOS) or **Ctrl+Enter**, or **Run query**.
- **Results grid:** Sortable columns, resizable widths, sticky **#** index, multi-cell
  selection (drag or **Shift+arrow**), **⌘/Ctrl+C** as **TSV**, **Copy JSON**,
  **Export CSV**, double-click for full cell value. Sets above **200** rows use
  virtualized scrolling.

## Ask tab

Optional local LLM assistant via [Ollama](https://ollama.com).

**Setup:**

1. Install Ollama (e.g. `brew install ollama` on macOS).
2. Pull a model (default **`qwen3:4b`**):

   ```bash
   ollama pull qwen3:4b
   ```

   For **`qwen3:8b`**, set **`DCC_LLM_MODEL=qwen3:8b`** when starting the backend.
3. Keep the Ollama daemon running, then **`make dev`**. Open **Ask**, type a question,
   and optional **max_rows** for the result preview.

The backend calls **`DCC_LLM_BASE_URL`** (default `http://127.0.0.1:11434`), drafts a
read-only **`SELECT`/`WITH`**, runs it through the same validation as **`POST /api/query`**
, and returns a concise answer. Set **`DCC_AGENT_SUMMARIZE_WITH_LLM=true`** for a second
model summarization pass. Open generated SQL in the **SQL** tab.

**LLM / agent settings** (all prefixed **`DCC_`**; see [`backend/app/config.py`](../backend/app/config.py)):
**`LLM_BASE_URL`**, **`LLM_MODEL`**, **`LLM_TIMEOUT_SECONDS`**, **`LLM_SQL_NUM_PREDICT`**,
**`LLM_SUMMARY_NUM_PREDICT`**, **`LLM_TEMPERATURE`**, **`LLM_THINK`**;
**`AGENT_CONTEXT_MAX_COLUMNS`**, **`AGENT_MAX_ROWS`**, **`AGENT_SQL_ATTEMPTS`**,
**`AGENT_SUMMARIZE_WITH_LLM`**, **`AGENT_SUMMARIZE_MAX_JSON_CHARS`**.

**Submit / stop:** **⌘+Enter** or **Ctrl+Enter** to submit; **Esc** stops an in-flight stream.

**Conversations:** Stored in workspace tables **`dcc_ask_conversations`** and
**`dcc_ask_turns`**. REST:
**`GET/POST /api/ask/conversations`**, **`PATCH/DELETE /api/ask/conversations/{id}`**,
**`GET /api/ask/conversations/{id}/turns`**, **`DELETE .../turns/{turn_id}`**.
Send **`conversation_id`** and optional **`use_history`** (default true) on
**`POST /api/agent/ask/stream`** so turns append and prior context is included
(bounded to recent turns).

**Streaming API:** **`POST /api/agent/ask/stream`** with body
**`{ "question": "...", "dataset_ids": ["ds_001"] | null, "max_rows": 200, "conversation_id": "<optional>", "use_history": true }`**.
Server-Sent Events: `meta`, `stage` (`context` · `draft_sql` · `execute` · `retry` ·
`summarize`), `sql_attempt`, `sql`, `query_result`, `token`, `answer`, `timing`
(`total_ms`), `turn` (`turn_id`, `conversation_id`, `seq`), `error`, `done`.

**Health:** **`GET /api/health`** includes an **`llm`** reachability probe for the
configured Ollama endpoint. CI does not run Ollama; backend tests mock LLM HTTP calls.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| **⌘/Ctrl+K** | Command palette |
| **?** | Shortcuts sheet |
| **/** | Focus dataset search |
| **g** then **o** / **c** / **q** / **s** / **a** / **y** | Jump to Overview / Columns / Quality / Samples / Ask / SQL |
| **r** | Refresh cached queries |
