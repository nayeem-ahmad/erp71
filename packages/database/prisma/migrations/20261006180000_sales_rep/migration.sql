-- The employee responsible for a customer ("Sales By"), and the copy each sale
-- takes of it when it is made. Both optional; clearing the employee leaves them
-- empty rather than blocking the delete.
ALTER TABLE "Customer" ADD COLUMN "sales_rep_id" TEXT;
ALTER TABLE "Sale" ADD COLUMN "sales_rep_id" TEXT;

CREATE INDEX "Sale_tenant_id_sales_rep_id_idx" ON "Sale"("tenant_id", "sales_rep_id");

ALTER TABLE "Customer" ADD CONSTRAINT "Customer_sales_rep_id_fkey" FOREIGN KEY ("sales_rep_id") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_sales_rep_id_fkey" FOREIGN KEY ("sales_rep_id") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
