-- KPI scorecard, phase 3: classify expense accounts for CAC, EBITDA and gross margin.
-- Production applies schema via `prisma db push`; this file is the history.

ALTER TABLE "accounts" ADD COLUMN "kpi_class" TEXT;
