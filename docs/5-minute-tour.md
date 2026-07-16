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

## 2. Start from Overview

The first upload opens **Overview**. Select `customers.csv` and read the profile narrative,
likely grain, quality score, and highest-impact issues. Open **Samples** once, then return
to Overview. The files are deliberately small, so profiling should finish quickly.

## 3. Verify a relationship and run its join

On the customers Overview, find the suggested `customer_id` relationship with orders.
Choose **Verify**, review the aggregate overlap verdict, then **Confirm**. Choose
**Open join SQL** and run the generated read-only preview. It uses the registered view
names, quoted columns, and a 100-row limit without exposing source paths.

For a grouped follow-up, try:

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

## 4. Save and download a chart

Select orders and open **Charts**. Build a bar or histogram, choose **Save**, and give it a
short name. Change the title and use **Save changes**. Open another tab, return to Charts,
and reopen it from **Saved chart** (or from Overview). Download the chart as **PNG**, its
current result as **CSV**, and its normalized specification as **JSON**.

## 5. Delete the datasets

Delete orders from the app. The confirmation names the saved chart and relationship
decision counts that will be removed. Confirm, then verify those dependencies disappear.
App-owned uploaded copies are removed when their datasets are unregistered. External files
registered through advanced path registration are never deleted by unregistering.

For a full local cleanup, see [README — Upgrading](../README.md#upgrading--workspace-schema)
(`make clean-local`).
