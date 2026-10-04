-- Indexes for hot sequential scans found in production's pg_stat_user_tables
-- on 2026-10-04 (statistics never reset). pg_stat_statements was not on yet, so
-- each one was chosen from the code that reads the table: every one backs a
-- filter on a column that no existing index leads with, which left Postgres no
-- access path but a full scan of the table, across every tenant.
--
-- Production applies the schema with `prisma db push`, which builds these
-- without CONCURRENTLY and so blocks writes to the table while it runs. Every
-- table here is under 65k rows, so each build takes well under a second.

-- PaymentRecord.sale_id: every `include: { payments }` on a sale (the sales
-- list, the sale screen, the invoice print, the cashier-session close, the
-- daily report), the deleteMany a sale edit runs, and the cascade behind a sale
-- delete. 75,898 full scans against 4 index scans.
-- CreateIndex
CREATE INDEX "PaymentRecord_sale_id_idx" ON "PaymentRecord"("sale_id");
