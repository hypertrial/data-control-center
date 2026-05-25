# Security Policy

## Supported Versions

| Version | Supported |
| --- | --- |
| 1.1.x | Yes |
| 1.0.x | Best-effort only; upgrade to 1.1.0 |
| 0.1.0 | No |
| &lt; 0.1.0 | No |

Security fixes land on **`main`** and are included in the next **1.1.x** patch release.
See [`docs/RELEASE.md`](docs/RELEASE.md) for tagging steps.

## Reporting A Vulnerability

Please report vulnerabilities through GitHub private vulnerability reporting for
`hypertrial/data-control-center`. Do not open public issues for suspected security
vulnerabilities.

Include:

- A short description of the issue.
- Steps to reproduce.
- Impact and affected versions or commits, if known.
- Any relevant logs or screenshots with secrets and private data redacted.

## Security Model

Data Control Center is intended for **local workstation use only**.

### What this app is not

- Not designed for hosted, production, shared-network, or multi-user deployments.
- The local API token is **not** user authentication, authorization, tenancy, or remote
  access control—it mitigates blind cross-site writes to localhost APIs.
- If you need a hosted or multi-user deployment, treat that as a separate product
  security design rather than a configuration change.

### Default protections

By default the backend:

- Accepts only loopback/local requests (**`DCC_LOCAL_ONLY=true`**,
  **`DCC_ALLOW_NON_LOCAL_HOST=false`**).
- Rejects non-local `Host`, `Origin`, `Referer`, or client addresses.
- Generates a per-process local API token unless **`DCC_LOCAL_API_TOKEN`** is set.
- Requires **`X-DCC-Local-Token`** on protected API endpoints
  (**`DCC_REQUIRE_LOCAL_API_TOKEN=true`**).
- Exposes that token to the browser only via **`GET /api/local-session`** from local
  requests.

For CLI or API scripts, call **`GET /api/local-session`** locally or start the backend
with **`DCC_LOCAL_API_TOKEN=<token>`** and send **`X-DCC-Local-Token: <token>`**. Do not
expose the backend on a LAN or public interface unless you accept the unsafe local-only
override risk.

### Local data

- Uploaded and registered datasets can contain sensitive local files.
- **`.dcc_workspace.duckdb`** and **`.dcc_uploads/`** are private local data. Back up,
  retain, or delete them according to your own policies.

### Registration and uploads

Path-based registration, upload limits, and related **`DCC_*`** settings are documented in
[`backend/README.md`](backend/README.md#configuration) (see **Local-only security** and
**Uploads and path registration**). Implementation: [`backend/app/services/registry.py`](backend/app/services/registry.py).
DuckDB relation import uses either app-staged uploads or **open-local** / **pick-local** references
under allowed registration roots (same **`ensure_registration_allowed`** checks as path registration).
Inspect/import
APIs resolve **`source_id`** only (staged upload id or **`loc_*`** metadata); they do not grant SQL users
permission to run `ATTACH` on arbitrary paths. Local-open metadata is stored under the app upload tree and
expires per **`DCC_DUCKDB_LOCAL_OPEN_TTL_HOURS`**.
