#!/bin/sh
# Read-only report of sales recorded under one branch whose customer belongs
# to another (`Sale.store_id` <> `Customer.store_id`). Cancelled sales are left
# out.
#
# Only SELECTs, in a READ ONLY transaction: nothing is written. Run from a
# machine with SSH access to the VPS:
#
#   ssh root@66.116.236.127 'sh -s' < scripts/ops/cross-branch-sales-report.sh
#
# One tenant (name match, case-insensitive), and more detail rows than the
# default 200:
#
#   ssh root@66.116.236.127 'TENANT="KH Tradind" LIMIT=1000 sh -s' < scripts/ops/cross-branch-sales-report.sh
#
# Output:
#   1. per tenant — cross-branch sales, the customers involved, their total,
#      and how many sales with a customer the tenant has in all
#   2. per branch pair — sale branch × customer branch
#   3. the sales themselves, newest first, up to LIMIT rows
set -eu

DB_CONTAINER="${DB_CONTAINER:-erp71-db-1}"
TENANT="${TENANT:-}"
LIMIT="${LIMIT:-200}"

case "$LIMIT" in
    ''|*[!0-9]*) echo "LIMIT must be a whole number" >&2; exit 1 ;;
esac

docker exec -i -e TENANT="$TENANT" -e LIMIT="$LIMIT" "$DB_CONTAINER" sh -c \
    'psql -v ON_ERROR_STOP=1 -v tenant="$TENANT" -v lim="$LIMIT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -P pager=off' <<'SQL'
BEGIN READ ONLY;

-- A read-only transaction allows no CREATE, so each query repeats the CTE.

\echo
\echo '== Per tenant =='
WITH cross_branch AS (
    SELECT t.id              AS tenant_id,
           t.name            AS tenant,
           sa.serial_number,
           sa.reference_number,
           sa.sale_date,
           sa.total_amount,
           sa.status,
           ss.name           AS sale_branch,
           c.id              AS customer_id,
           c.customer_code,
           c.name            AS customer,
           c.phone,
           cs.name           AS customer_branch
    FROM "Sale" sa
    JOIN "Customer" c ON c.id = sa.customer_id
    JOIN "Tenant" t   ON t.id = sa.tenant_id
    JOIN "Store" ss   ON ss.id = sa.store_id
    JOIN "Store" cs   ON cs.id = c.store_id
    WHERE sa.store_id <> c.store_id
      AND sa.status <> 'CANCELLED'
      AND (:'tenant' = '' OR t.name ILIKE '%' || :'tenant' || '%')
)
SELECT x.tenant,
       COUNT(*)                      AS cross_branch_sales,
       COUNT(DISTINCT x.customer_id) AS customers,
       SUM(x.total_amount)           AS amount,
       (SELECT COUNT(*) FROM "Sale" sa
         WHERE sa.tenant_id = x.tenant_id AND sa.customer_id IS NOT NULL
           AND sa.status <> 'CANCELLED') AS sales_with_customer
FROM cross_branch x
GROUP BY x.tenant_id, x.tenant
ORDER BY cross_branch_sales DESC;

\echo
\echo '== Per branch pair =='
WITH cross_branch AS (
    SELECT t.id              AS tenant_id,
           t.name            AS tenant,
           sa.serial_number,
           sa.reference_number,
           sa.sale_date,
           sa.total_amount,
           sa.status,
           ss.name           AS sale_branch,
           c.id              AS customer_id,
           c.customer_code,
           c.name            AS customer,
           c.phone,
           cs.name           AS customer_branch
    FROM "Sale" sa
    JOIN "Customer" c ON c.id = sa.customer_id
    JOIN "Tenant" t   ON t.id = sa.tenant_id
    JOIN "Store" ss   ON ss.id = sa.store_id
    JOIN "Store" cs   ON cs.id = c.store_id
    WHERE sa.store_id <> c.store_id
      AND sa.status <> 'CANCELLED'
      AND (:'tenant' = '' OR t.name ILIKE '%' || :'tenant' || '%')
)
SELECT tenant, sale_branch, customer_branch,
       COUNT(*)                    AS sales,
       COUNT(DISTINCT customer_id) AS customers,
       SUM(total_amount)           AS amount
FROM cross_branch
GROUP BY tenant_id, tenant, sale_branch, customer_branch
ORDER BY tenant, sales DESC;

\echo
\echo '== Sales (newest first) =='
WITH cross_branch AS (
    SELECT t.id              AS tenant_id,
           t.name            AS tenant,
           sa.serial_number,
           sa.reference_number,
           sa.sale_date,
           sa.total_amount,
           sa.status,
           ss.name           AS sale_branch,
           c.id              AS customer_id,
           c.customer_code,
           c.name            AS customer,
           c.phone,
           cs.name           AS customer_branch
    FROM "Sale" sa
    JOIN "Customer" c ON c.id = sa.customer_id
    JOIN "Tenant" t   ON t.id = sa.tenant_id
    JOIN "Store" ss   ON ss.id = sa.store_id
    JOIN "Store" cs   ON cs.id = c.store_id
    WHERE sa.store_id <> c.store_id
      AND sa.status <> 'CANCELLED'
      AND (:'tenant' = '' OR t.name ILIKE '%' || :'tenant' || '%')
)
SELECT tenant,
       sale_date::date AS sale_date,
       serial_number,
       reference_number,
       sale_branch,
       customer_code,
       customer,
       phone,
       customer_branch,
       total_amount,
       status
FROM cross_branch
ORDER BY tenant, sale_date DESC, serial_number DESC
LIMIT :lim;

ROLLBACK;
SQL
