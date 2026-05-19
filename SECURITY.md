# Security Policy

## Supported Versions

Until Data Control Center has formal releases, security fixes are handled on the
`main` branch.

## Reporting A Vulnerability

Please report vulnerabilities through GitHub private vulnerability reporting for
`hypertrial/data-control-center`. Do not open public issues for suspected
security vulnerabilities.

Include:

- A short description of the issue.
- Steps to reproduce.
- Impact and affected versions or commits, if known.
- Any relevant logs or screenshots with secrets and private data redacted.

## Security Model

Data Control Center is intended for local workstation use only.

- It is not designed for hosted, production, shared-network, or multi-user
  deployments.
- The local API token protects against blind cross-site localhost writes. It is
  not account authentication, authorization, tenancy, or a remote access control
  system.
- Uploaded and registered datasets may contain sensitive local files.
- Workspace databases such as `.dcc_workspace.duckdb` and upload directories such
  as `.dcc_uploads/` are private local data.
- Users are responsible for local backups, retention, and secure deletion of
  their own data.

If you need a hosted or multi-user deployment, treat that as a separate product
security design rather than a configuration change.
