#!/bin/sh
# Read-only preview of where sync:party-branch will place customers, suppliers
# and storefront orders, per tenant — run BEFORE releasing the branch-attached
# parties change (docs/superpowers/specs/2026-10-10-branch-attached-parties-design.md).
#
# Only SELECTs, in a READ ONLY transaction: nothing is written, no column is
# added, no lock beyond a plain read is taken. Run from a machine with SSH
# access to the VPS:
#
#   ssh root@66.116.236.127 'sh -s' < scripts/ops/party-branch-report.sh
#
# Columns per tenant:
#   stores           physical branches today
#   cust_kept        customers that already have a branch (kept)
#   cust_by_sales    placed on their most-sales branch
#   cust_online      storefront accounts with no sale → the new online branch
#   cust_main        everything else → the main (oldest) branch
#   supp_by_purch    suppliers placed on their most-purchases branch
#   supp_main        suppliers → the main branch
#   orders_online    storefront orders → the online branch
#   needs_online     1 when an "Online Store" branch will be created
#   NO_STORE         tenants with rows but no branch at all: the sync will fail
#                    on these and abort the deploy — fix them first
set -eu

DB_CONTAINER="${DB_CONTAINER:-erp71-db-1}"

docker exec -i "$DB_CONTAINER" sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -P pager=off' <<'SQL'
BEGIN READ ONLY;

WITH cust_sales AS (
    SELECT c.id, c.tenant_id,
           EXISTS (SELECT 1 FROM "Sale" sa WHERE sa.customer_id = c.id AND sa.status <> 'CANCELLED') AS has_sale
    FROM "Customer" c
    WHERE c.store_id IS NULL
), supp_purch AS (
    SELECT su.id, su.tenant_id,
           EXISTS (SELECT 1 FROM "Purchase" p WHERE p.supplier_id = su.id AND p.status <> 'CANCELLED') AS has_purchase
    FROM "Supplier" su
)
SELECT t.name AS tenant,
       (SELECT COUNT(*) FROM "Store" s WHERE s.tenant_id = t.id) AS stores,
       (SELECT COUNT(*) FROM "Customer" c WHERE c.tenant_id = t.id AND c.store_id IS NOT NULL) AS cust_kept,
       (SELECT COUNT(*) FROM cust_sales x WHERE x.tenant_id = t.id AND x.has_sale) AS cust_by_sales,
       (SELECT COUNT(*) FROM cust_sales x JOIN "Customer" c ON c.id = x.id
         WHERE x.tenant_id = t.id AND NOT x.has_sale AND c.user_id IS NOT NULL) AS cust_online,
       (SELECT COUNT(*) FROM cust_sales x JOIN "Customer" c ON c.id = x.id
         WHERE x.tenant_id = t.id AND NOT x.has_sale AND c.user_id IS NULL) AS cust_main,
       (SELECT COUNT(*) FROM supp_purch x WHERE x.tenant_id = t.id AND x.has_purchase) AS supp_by_purch,
       (SELECT COUNT(*) FROM supp_purch x WHERE x.tenant_id = t.id AND NOT x.has_purchase) AS supp_main,
       (SELECT COUNT(*) FROM storefront_orders o WHERE o."tenantId" = t.id) AS orders_online,
       CASE WHEN EXISTS (SELECT 1 FROM storefront_orders o WHERE o."tenantId" = t.id)
              OR EXISTS (SELECT 1 FROM cust_sales x JOIN "Customer" c ON c.id = x.id
                         WHERE x.tenant_id = t.id AND NOT x.has_sale AND c.user_id IS NOT NULL)
            THEN 1 ELSE 0 END AS needs_online
FROM "Tenant" t
ORDER BY stores DESC, t.name;

SELECT t.id AS "NO_STORE tenant", t.name
FROM "Tenant" t
WHERE NOT EXISTS (SELECT 1 FROM "Store" s WHERE s.tenant_id = t.id)
  AND (EXISTS (SELECT 1 FROM "Customer" c WHERE c.tenant_id = t.id)
    OR EXISTS (SELECT 1 FROM "Supplier" su WHERE su.tenant_id = t.id)
    OR EXISTS (SELECT 1 FROM storefront_orders o WHERE o."tenantId" = t.id));

ROLLBACK;
SQL
