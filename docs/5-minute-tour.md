# Five-Minute Tour

This tour uses only tiny synthetic files in `examples/`. Do not use private datasets
while evaluating the app for the first time.

**Prerequisites:** See [README Quick start](../README.md#quick-start-no-llm-required)
(`make install` && `make dev`, then open **`http://127.0.0.1:5173`**). Single-server
alternative: `make serve` → **`http://127.0.0.1:8000`**.

Fixture descriptions: [`examples/README.md`](../examples/README.md).

## 1. Upload safe example data

Open the datasets area and upload (files or **Choose folder**):

- `examples/customers.csv`
- `examples/events.jsonl`
- `examples/orders.parquet`

Uploads are copied into the app-owned upload directory before registration.

## 2. Inspect the data

The app opens on **Columns** by default. Select each dataset and browse **Columns** and
**Samples** (schema, profile summaries, and sample rows). Quality scores and column flags
appear on **Columns**—there is no separate Quality tab. The files are deliberately small
so inspection is immediate.

## 3. Run a query

Open the SQL workspace and try:

```sql
select
  customer_id,
  count(*) as order_count,
  sum(total_usd) as total_usd
from orders
group by customer_id
order by total_usd desc;
```

If the registered view name differs because of a duplicate local name, use the view
name shown in the dataset sidebar.

## 4. Delete the datasets

Delete the uploaded datasets from the app. App-owned uploaded copies are removed when
their datasets are unregistered. External files registered through advanced path
registration are never deleted by unregistering.

For a full local cleanup, see [README — Upgrading](../README.md#upgrading--workspace-schema)
(`make clean-local`).
