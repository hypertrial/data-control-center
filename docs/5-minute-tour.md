# Five-Minute Tour

This tour uses only tiny synthetic files in `examples/`. Do not use private
datasets while evaluating the app for the first time.

## 1. Start The App

From the repository root:

```bash
make install
make dev
```

Open the frontend URL printed by Vite, usually `http://127.0.0.1:5173`.

## 2. Upload Safe Example Data

Open the datasets area and upload:

- `examples/customers.csv`
- `examples/events.jsonl`
- `examples/orders.parquet`

Uploads are copied into the app-owned upload directory before registration.

## 3. Inspect The Data

Select each dataset and review:

- Schema and column types.
- Profile summaries.
- Sample rows.

The files are deliberately small so inspection is immediate.

## 4. Run A Query

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

If the registered view name differs because of a duplicate local name, use the
view name shown in the dataset sidebar.

## 5. Delete The Datasets

Delete the uploaded datasets from the app. App-owned uploaded copies are removed
when their datasets are unregistered. External files registered through advanced
path registration are never deleted by unregistering.

For a full local cleanup, run `make clean-local` only when you intentionally want
to delete workspace state and generated artifacts.
