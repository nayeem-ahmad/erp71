-- Owner/proprietor name, mainly for ORGANIZATION customers imported from a shop list.
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "owner_name" TEXT;

-- Phone is no longer mandatory: master-data imports routinely carry customers
-- keyed on customer_code with no contact number. The @@unique([tenant_id, phone])
-- index stays valid — Postgres treats NULLs as distinct.
ALTER TABLE "Customer" ALTER COLUMN "phone" DROP NOT NULL;
