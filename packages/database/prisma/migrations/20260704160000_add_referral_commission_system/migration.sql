-- CreateEnum
CREATE TYPE "ReferralCommissionStatus" AS ENUM ('PENDING', 'EARNED', 'PAID');

-- CreateTable
CREATE TABLE "Referee" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "referral_code" TEXT NOT NULL,
    "commission_rate" DECIMAL(5,2) NOT NULL,
    "signup_discount" DECIMAL(5,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Referee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralSignup" (
    "id" TEXT NOT NULL,
    "referee_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "discount_pct" DECIMAL(5,2) NOT NULL,
    "commission_pct" DECIMAL(5,2) NOT NULL,
    "plan_amount" DECIMAL(10,2),
    "commission_amount" DECIMAL(10,2),
    "status" "ReferralCommissionStatus" NOT NULL DEFAULT 'PENDING',
    "signed_up_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "earned_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "referee_payment_id" TEXT,

    CONSTRAINT "ReferralSignup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefereePayment" (
    "id" TEXT NOT NULL,
    "referee_id" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "method" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "paid_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefereePayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Referee_email_key" ON "Referee"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Referee_referral_code_key" ON "Referee"("referral_code");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralSignup_tenant_id_key" ON "ReferralSignup"("tenant_id");

-- CreateIndex
CREATE INDEX "ReferralSignup_referee_id_status_idx" ON "ReferralSignup"("referee_id", "status");

-- CreateIndex
CREATE INDEX "ReferralSignup_status_idx" ON "ReferralSignup"("status");

-- CreateIndex
CREATE INDEX "RefereePayment_referee_id_idx" ON "RefereePayment"("referee_id");

-- AddForeignKey
ALTER TABLE "ReferralSignup" ADD CONSTRAINT "ReferralSignup_referee_id_fkey" FOREIGN KEY ("referee_id") REFERENCES "Referee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralSignup" ADD CONSTRAINT "ReferralSignup_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralSignup" ADD CONSTRAINT "ReferralSignup_referee_payment_id_fkey" FOREIGN KEY ("referee_payment_id") REFERENCES "RefereePayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefereePayment" ADD CONSTRAINT "RefereePayment_referee_id_fkey" FOREIGN KEY ("referee_id") REFERENCES "Referee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;