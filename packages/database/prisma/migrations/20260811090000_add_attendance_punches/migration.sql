-- The raw in/out log behind the one-row-per-day attendance summary.
--
-- AttendanceRecord can hold exactly one arrival and one departure per day,
-- which is wrong on any day with a midday errand, a split shift or a mistyped
-- time corrected later. Punches are the evidence; the day row is rebuilt from
-- them (first IN -> clock_in, last OUT -> clock_out) rather than being the only
-- copy of what happened.
CREATE TABLE "attendance_punches" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "punched_at" TIMESTAMP(3) NOT NULL,
    "direction" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'ADMIN',
    "notes" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "store_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_punches_pkey" PRIMARY KEY ("id")
);

-- Every read is "this employee, this day" (the rebuild) or "this tenant, this
-- range" (the management screen).
CREATE INDEX "attendance_punches_tenant_id_employee_id_date_idx" ON "attendance_punches"("tenant_id", "employee_id", "date");
CREATE INDEX "attendance_punches_tenant_id_date_idx" ON "attendance_punches"("tenant_id", "date");

ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;
