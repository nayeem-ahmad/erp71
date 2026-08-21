-- Imports under a Letter of Credit.
--
-- An ImportShipment is a file open for the 60–150 days between committing to a
-- foreign supplier and the goods clearing customs. Receiving one emits an
-- ordinary Purchase at landed cost rather than replacing it, so everything
-- downstream of a purchase is untouched by this migration.

-- --- Enum additions -------------------------------------------------------
ALTER TYPE "StorePermission" ADD VALUE 'VIEW_IMPORTS';
ALTER TYPE "StorePermission" ADD VALUE 'MANAGE_IMPORTS';
ALTER TYPE "StorePermission" ADD VALUE 'MANAGE_IMPORT_COSTS';

ALTER TYPE "PostingRuleEventType" ADD VALUE 'import_cost';
ALTER TYPE "PostingRuleEventType" ADD VALUE 'import_receipt';
ALTER TYPE "PostingRuleEventType" ADD VALUE 'import_settlement';

-- --- Master data ----------------------------------------------------------
ALTER TABLE "Supplier"
    ADD COLUMN "is_foreign" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "country" TEXT,
    ADD COLUMN "currency" TEXT,
    ADD COLUMN "bank_name" TEXT,
    ADD COLUMN "swift_code" TEXT,
    ADD COLUMN "beneficiary_name" TEXT,
    ADD COLUMN "beneficiary_account" TEXT;

CREATE INDEX "Supplier_tenant_id_is_foreign_idx" ON "Supplier"("tenant_id", "is_foreign");

ALTER TABLE "Product"
    ADD COLUMN "hs_code" TEXT,
    ADD COLUMN "country_of_origin" TEXT,
    ADD COLUMN "net_weight_kg" DECIMAL(12, 3),
    ADD COLUMN "cbm" DECIMAL(12, 4);

-- --- Shipments ------------------------------------------------------------
CREATE TABLE "ImportShipment" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "supplier_id" TEXT,
    "purchase_id" TEXT,
    "customer_pi_id" TEXT,
    "reference_number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',

    "lc_number" TEXT,
    "lc_type" TEXT,
    "lc_date" TIMESTAMP(3),
    "lc_expiry_date" TIMESTAMP(3),
    "latest_shipment_date" TIMESTAMP(3),
    "bank_name" TEXT,
    "bank_branch" TEXT,
    "margin_percent" DECIMAL(5, 2),
    "tenor_days" INTEGER,

    "currency" TEXT NOT NULL DEFAULT 'USD',
    "fx_rate_at_open" DECIMAL(12, 6),
    "fx_rate_at_settle" DECIMAL(12, 6),
    "invoice_value_fc" DECIMAL(16, 2) NOT NULL DEFAULT 0,

    "incoterm" TEXT,
    "bl_number" TEXT,
    "bl_date" TIMESTAMP(3),
    "vessel_name" TEXT,
    "port_of_loading" TEXT,
    "port_of_discharge" TEXT,
    "etd" TIMESTAMP(3),
    "eta" TIMESTAMP(3),

    "be_number" TEXT,
    "be_date" TIMESTAMP(3),
    "cf_agent_name" TEXT,

    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportShipment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ImportShipment_purchase_id_key" ON "ImportShipment"("purchase_id");
CREATE UNIQUE INDEX "ImportShipment_tenant_id_reference_number_key"
    ON "ImportShipment"("tenant_id", "reference_number");
CREATE INDEX "ImportShipment_tenant_id_status_idx" ON "ImportShipment"("tenant_id", "status");
CREATE INDEX "ImportShipment_tenant_id_lc_number_idx" ON "ImportShipment"("tenant_id", "lc_number");
-- The LC register sorts on this: an expired LC is a real loss.
CREATE INDEX "ImportShipment_tenant_id_lc_expiry_date_idx" ON "ImportShipment"("tenant_id", "lc_expiry_date");
CREATE INDEX "ImportShipment_tenant_id_created_at_idx" ON "ImportShipment"("tenant_id", "created_at");

CREATE TABLE "ImportShipmentItem" (
    "id" TEXT NOT NULL,
    "shipment_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_fc" DECIMAL(16, 4) NOT NULL,
    "hs_code" TEXT,
    "net_weight_kg" DECIMAL(12, 3),
    "cbm" DECIMAL(12, 4),
    "landed_unit_cost" DECIMAL(14, 4),

    CONSTRAINT "ImportShipmentItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ImportShipmentItem_shipment_id_idx" ON "ImportShipmentItem"("shipment_id");

CREATE TABLE "ImportCost" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "shipment_id" TEXT NOT NULL,
    "cost_type" TEXT NOT NULL,
    "description" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "amount" DECIMAL(16, 2) NOT NULL,
    "fx_rate" DECIMAL(12, 6),
    "amount_bdt" DECIMAL(16, 2) NOT NULL,
    "allocation_basis" TEXT NOT NULL DEFAULT 'VALUE',
    "is_capitalized" BOOLEAN NOT NULL DEFAULT true,
    "receivable_account_id" TEXT,
    "paid_at" TIMESTAMP(3),
    "paid_from_account_id" TEXT,
    "voucher_id" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportCost_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ImportCost_tenant_id_shipment_id_idx" ON "ImportCost"("tenant_id", "shipment_id");
CREATE INDEX "ImportCost_tenant_id_cost_type_idx" ON "ImportCost"("tenant_id", "cost_type");

CREATE TABLE "ImportDocument" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "shipment_id" TEXT NOT NULL,
    "doc_type" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT,
    "file_size" INTEGER,
    "uploaded_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ImportDocument_tenant_id_shipment_id_idx" ON "ImportDocument"("tenant_id", "shipment_id");

-- --- Foreign keys ---------------------------------------------------------
ALTER TABLE "ImportShipment"
    ADD CONSTRAINT "ImportShipment_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "ImportShipment_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "ImportShipment_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "ImportShipment_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "ImportShipment_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ImportShipmentItem"
    ADD CONSTRAINT "ImportShipmentItem_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "ImportShipment"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "ImportShipmentItem_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ImportCost"
    ADD CONSTRAINT "ImportCost_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "ImportCost_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "ImportShipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ImportDocument"
    ADD CONSTRAINT "ImportDocument_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "ImportDocument_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "ImportShipment"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "ImportDocument_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
