import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { seedDefaultLeadTaxonomy } from '@erp71/database';
import { isDashboardPreference, normalizePasswordPolicy, type PasswordPolicy } from '@erp71/shared-types';
import { DatabaseService } from '../database/database.service';
import { TenantTimezoneService } from '../database/tenant-timezone.service';
import { PlanEntitlementsService } from '../subscription-plans/plan-entitlements.service';
import { isValidTimeZone } from '../common/tenant-time.util';
import { StorefrontSettingsDto } from '../storefront/storefront.dto';
import { UpdateBrandingDto } from './update-branding.dto';
import { UpdateDashboardSettingsDto } from './dashboard-settings.dto';
import {
    PASSWORD_POLICY_SELECT,
    columnsFromPolicy,
    policyFromColumns,
} from '../password-policy/password-policy.columns';
import { UpdatePasswordPolicyDto } from './password-policy.dto';
import { UpdateLocalizationSettingsDto } from './localization-settings.dto';

@Injectable()
export class TenantsService {
    constructor(
        private readonly db: DatabaseService,
        private readonly timezones: TenantTimezoneService,
        private readonly planEntitlements: PlanEntitlementsService,
    ) {}

    async updateStorefrontSettings(tenantId: string, dto: StorefrontSettingsDto) {
        // `premiumStorefront` gates *switching the storefront on*, and nothing else
        // on this route. Two deliberate holes in that:
        //
        //  - A tenant whose storefront is already live keeps editing it, and keeps
        //    it live, whatever their plan says. The storefront shipped ungated, so
        //    enforcing it now would take a public shop offline for people who did
        //    nothing wrong.
        //  - Turning it *off* is always allowed. A plan gate that traps a tenant
        //    with a storefront they cannot retract is a support ticket, not a sale.
        //
        // The public shopper routes in StorefrontController are untouched — they
        // serve customers, not tenants, and must stay open.
        if (dto.storefront_enabled === true) {
            const current = await this.db.tenant.findUnique({
                where: { id: tenantId },
                select: { storefront_enabled: true },
            });
            if (!current?.storefront_enabled) {
                await this.planEntitlements.assertEntitlement(tenantId, 'premiumStorefront');
            }
        }

        // Validate slug format if provided
        if (dto.storefront_slug !== undefined && dto.storefront_slug !== null && dto.storefront_slug !== '') {
            const slugRegex = /^[a-z0-9-]{1,50}$/;
            if (!slugRegex.test(dto.storefront_slug)) {
                throw new BadRequestException(
                    'Slug must be lowercase letters, numbers, and hyphens only (max 50 chars)',
                );
            }
        }

            const data: Record<string, string | boolean | null> = {};
            if (dto.storefront_slug !== undefined) data.storefront_slug = dto.storefront_slug || null;
            if (dto.storefront_enabled !== undefined) data.storefront_enabled = dto.storefront_enabled;
            if (dto.storefront_banner !== undefined) data.storefront_banner = dto.storefront_banner || null;
            if (dto.storefront_hero_image !== undefined) data.storefront_hero_image = dto.storefront_hero_image || null;
            if (dto.storefront_hero_headline !== undefined) data.storefront_hero_headline = dto.storefront_hero_headline || null;
            if (dto.storefront_logo !== undefined) data.storefront_logo = dto.storefront_logo || null;
            if (dto.storefront_logo_show_name !== undefined) data.storefront_logo_show_name = dto.storefront_logo_show_name;

        return this.db.tenant.update({
            where: { id: tenantId },
                data,
            select: {
                id: true,
                name: true,
                storefront_slug: true,
                storefront_enabled: true,
                storefront_banner: true,
                storefront_hero_image: true,
                storefront_hero_headline: true,
                storefront_logo: true,
                storefront_logo_show_name: true,
            },
        });
    }

    async getStorefrontSettings(tenantId: string) {
        return this.db.tenant.findUnique({
            where: { id: tenantId },
            select: {
                id: true,
                name: true,
                storefront_slug: true,
                storefront_enabled: true,
                storefront_banner: true,
                storefront_hero_image: true,
                storefront_hero_headline: true,
                storefront_logo: true,
                storefront_logo_show_name: true,
            },
        });
    }

    async getBranding(tenantId: string) {
        return this.db.tenant.findUnique({
            where: { id: tenantId },
            select: {
                brand_primary_color: true,
                brand_logo_url: true,
                brand_favicon_url: true,
                brand_business_name: true,
            },
        });
    }

    async getTaxSettings(tenantId: string) {
        return this.db.tenant.findUnique({
            where: { id: tenantId },
            select: {
                default_vat_rate: true,
                vat_registration_no: true,
                business_tin: true,
            },
        });
    }

    async updateTaxSettings(tenantId: string, dto: { default_vat_rate?: number | null; vat_registration_no?: string | null; business_tin?: string | null }) {
        const data: Record<string, number | string | null> = {};
        if (dto.default_vat_rate !== undefined) data.default_vat_rate = dto.default_vat_rate;
        if (dto.vat_registration_no !== undefined) data.vat_registration_no = dto.vat_registration_no || null;
        if (dto.business_tin !== undefined) data.business_tin = dto.business_tin || null;

        return this.db.tenant.update({
            where: { id: tenantId },
            data,
            select: {
                default_vat_rate: true,
                vat_registration_no: true,
                business_tin: true,
            },
        });
    }

    async updateBranding(tenantId: string, dto: UpdateBrandingDto) {
        const data: Record<string, string | null> = {};
        if (dto.brand_primary_color !== undefined) data.brand_primary_color = dto.brand_primary_color || null;
        if (dto.brand_logo_url !== undefined) data.brand_logo_url = dto.brand_logo_url || null;
        if (dto.brand_favicon_url !== undefined) data.brand_favicon_url = dto.brand_favicon_url || null;
        if (dto.brand_business_name !== undefined) data.brand_business_name = dto.brand_business_name || null;

        return this.db.tenant.update({
            where: { id: tenantId },
            data,
            select: {
                brand_primary_color: true,
                brand_logo_url: true,
                brand_favicon_url: true,
                brand_business_name: true,
            },
        });
    }

    async getSmsSettings(tenantId: string) {
        return this.db.tenant.findUnique({
            where: { id: tenantId },
            select: {
                sms_enabled: true,
                sms_on_sale: true,
                sms_on_low_stock: true,
            },
        });
    }

    async updateSmsSettings(
        tenantId: string,
        dto: { sms_enabled?: boolean; sms_on_sale?: boolean; sms_on_low_stock?: boolean },
    ) {
        const data: Record<string, boolean> = {};
        if (dto.sms_enabled !== undefined) data.sms_enabled = dto.sms_enabled;
        if (dto.sms_on_sale !== undefined) data.sms_on_sale = dto.sms_on_sale;
        if (dto.sms_on_low_stock !== undefined) data.sms_on_low_stock = dto.sms_on_low_stock;

        return this.db.tenant.update({
            where: { id: tenantId },
            data,
            select: {
                sms_enabled: true,
                sms_on_sale: true,
                sms_on_low_stock: true,
            },
        });
    }

    async getReportSettings(tenantId: string) {
        return this.db.tenant.findUnique({
            where: { id: tenantId },
            select: {
                report_weekly_enabled: true,
                report_monthly_enabled: true,
                report_email: true,
            },
        });
    }

    async updateReportSettings(
        tenantId: string,
        dto: { report_weekly_enabled?: boolean; report_monthly_enabled?: boolean; report_email?: string | null },
    ) {
        const data: Record<string, boolean | string | null> = {};
        if (dto.report_weekly_enabled !== undefined) data.report_weekly_enabled = dto.report_weekly_enabled;
        if (dto.report_monthly_enabled !== undefined) data.report_monthly_enabled = dto.report_monthly_enabled;
        if (dto.report_email !== undefined) data.report_email = dto.report_email || null;

        return this.db.tenant.update({
            where: { id: tenantId },
            data,
            select: {
                report_weekly_enabled: true,
                report_monthly_enabled: true,
                report_email: true,
            },
        });
    }

    async getLocalizationSettings(tenantId: string) {
        return this.db.tenant.findUnique({
            where: { id: tenantId },
            select: {
                default_locale: true,
                localization_enabled: true,
                secondary_locale: true,
                timezone: true,
            },
        });
    }

    async getDashboardSettings(tenantId: string) {
        const tenant = await this.db.tenant.findUnique({
            where: { id: tenantId },
            select: { dashboard_preference: true },
        });

        if (!tenant) {
            throw new NotFoundException('Tenant not found');
        }

        return {
            dashboard_preference: isDashboardPreference(tenant.dashboard_preference)
                ? tenant.dashboard_preference
                : 'AUTO',
        };
    }

    /**
     * Workspace-wide, so it is restricted to the roles that administer the
     * workspace — a cashier switching it would change what every colleague sees.
     */
    async updateDashboardSettings(
        tenantId: string,
        dto: UpdateDashboardSettingsDto,
        userRole: string | undefined,
    ) {
        if (userRole !== 'OWNER' && userRole !== 'MANAGER') {
            throw new ForbiddenException('Only an owner or manager can change the dashboard.');
        }

        if (dto.dashboard_preference === undefined) {
            return this.getDashboardSettings(tenantId);
        }

        const tenant = await this.db.tenant.update({
            where: { id: tenantId },
            data: { dashboard_preference: dto.dashboard_preference },
            select: { dashboard_preference: true },
        });

        return { dashboard_preference: tenant.dashboard_preference };
    }

    /**
     * The workspace's password rules, readable by any member.
     *
     * Not gated on the admin roles the PATCH is: the change-password form shows
     * every member the rules they have to satisfy, and a rule you are held to but
     * may not read is just a form that keeps saying no.
     */
    async getPasswordPolicy(tenantId: string): Promise<PasswordPolicy> {
        const tenant = await this.db.tenant.findUnique({
            where: { id: tenantId },
            select: PASSWORD_POLICY_SELECT,
        });

        if (!tenant) {
            throw new NotFoundException('Tenant not found');
        }

        return policyFromColumns(tenant);
    }

    /**
     * Workspace-wide, so it is restricted to the roles that administer the
     * workspace — the same OWNER/MANAGER gate the dashboard preference uses.
     * "Tenant Admin" resolves to MANAGER, so a workspace's admin can set this
     * without the owner.
     *
     * Tightening the policy never invalidates a password anyone already has, and
     * never signs anybody out: it applies the next time someone *sets* one. That
     * is a deliberate choice — a workspace that turned on a symbol requirement at
     * 11pm should not lock out every cashier mid-shift. The settings page says so
     * in as many words.
     */
    async updatePasswordPolicy(
        tenantId: string,
        dto: UpdatePasswordPolicyDto,
        userRole: string | undefined,
    ): Promise<PasswordPolicy> {
        if (userRole !== 'OWNER' && userRole !== 'MANAGER') {
            throw new ForbiddenException('Only an owner or admin can change the password policy.');
        }

        const current = await this.getPasswordPolicy(tenantId);
        // Normalized rather than trusted: the DTO bounds `min_length`, and this
        // re-clamps whatever survives, so no path can write a policy the
        // evaluator would have to second-guess.
        const merged = normalizePasswordPolicy({
            min_length: dto.min_length ?? current.min_length,
            require_uppercase: dto.require_uppercase ?? current.require_uppercase,
            require_lowercase: dto.require_lowercase ?? current.require_lowercase,
            require_number: dto.require_number ?? current.require_number,
            require_symbol: dto.require_symbol ?? current.require_symbol,
            block_common: dto.block_common ?? current.block_common,
        });

        const tenant = await this.db.tenant.update({
            where: { id: tenantId },
            data: columnsFromPolicy(merged),
            select: PASSWORD_POLICY_SELECT,
        });

        return policyFromColumns(tenant);
    }

    async clearData(tenantId: string, mode: 'transactions' | 'all', userRole: string | undefined) {
        if (userRole !== 'OWNER') throw new ForbiddenException('Only the shop owner can clear data');
        if (mode !== 'transactions' && mode !== 'all') {
            throw new BadRequestException('mode must be "transactions" or "all"');
        }

        // The whole wipe is one transaction so a half-cleared store is not a
        // reachable state. Prisma's default interactive-transaction timeout is
        // 5s, which a store carrying a full demo dataset (thousands of sales,
        // vouchers and movements across ~60 tables) blows straight through — the
        // clear then fails mid-way and rolls back, every time.
        await this.db.$transaction(async (tx) => {
            // --- Transactional / operational records ---

            // Demo-data batch history (metadata; both modes reset the append counter)
            await tx.demoDataBatch.deleteMany({ where: { tenant_id: tenantId } });

            // CRM operational (before Customer). CrmActivity goes first: it FKs
            // Lead and Customer with onDelete: Cascade, but an activity attached
            // to neither would otherwise survive the wipe.
            await tx.crmActivity.deleteMany({ where: { tenant_id: tenantId } });
            await tx.lead.deleteMany({ where: { tenant_id: tenantId } }); // cascades LeadConversation
            await tx.crmFollowUp.deleteMany({ where: { tenant_id: tenantId } });
            await tx.customerInteraction.deleteMany({ where: { tenant_id: tenantId } });
            await tx.crmCampaign.deleteMany({ where: { tenant_id: tenantId } }); // cascades CrmCampaignRecipient

            // Credit balances (before Customer / Supplier)
            await tx.customerCreditTransaction.deleteMany({ where: { tenant_id: tenantId } });
            await tx.supplierCreditTransaction.deleteMany({ where: { tenant_id: tenantId } });
            await tx.loyaltyTransaction.deleteMany({ where: { tenantId } });

            // Records referencing Sale (must go before Sale)
            await tx.warrantyClaim.deleteMany({ where: { tenant_id: tenantId } });
            await tx.deliveryOrder.deleteMany({ where: { tenantId } });
            await tx.salesReturn.deleteMany({ where: { tenant_id: tenantId } }); // cascades SalesReturnItem

            // Sales
            await tx.sale.deleteMany({ where: { tenant_id: tenantId } }); // cascades SaleItem, PaymentRecord
            await tx.quotation.deleteMany({ where: { tenant_id: tenantId } }); // cascades QuotationItem
            await tx.salesOrder.deleteMany({ where: { tenant_id: tenantId } }); // cascades SalesOrderItem

            // Purchases
            await tx.purchaseReturn.deleteMany({ where: { tenant_id: tenantId } }); // cascades PurchaseReturnItem
            await tx.purchase.deleteMany({ where: { tenant_id: tenantId } }); // cascades PurchaseItem
            await tx.purchaseOrder.deleteMany({ where: { tenant_id: tenantId } }); // cascades PurchaseOrderItem
            await tx.purchaseQuotation.deleteMany({ where: { tenant_id: tenantId } }); // cascades PurchaseQuotationItem
            await tx.productDemand.deleteMany({ where: { tenant_id: tenantId } }); // cascades ProductDemandItem

            // Inventory operational
            await tx.productionJob.deleteMany({ where: { tenantId } });
            await tx.inventoryMovement.deleteMany({ where: { tenant_id: tenantId } });
            await tx.inventoryShrinkage.deleteMany({ where: { tenant_id: tenantId } }); // cascades InventoryShrinkageItem
            await tx.warehouseTransfer.deleteMany({ where: { tenant_id: tenantId } }); // cascades WarehouseTransferItem
            await tx.stockTakeSession.deleteMany({ where: { tenant_id: tenantId } }); // cascades StockTakeCountLine

            // Records pointing at a Voucher, before the vouchers themselves.
            await tx.fundTransfer.deleteMany({ where: { tenant_id: tenantId } });
            await tx.investorProfitRun.deleteMany({ where: { tenant_id: tenantId } }); // cascades InvestorProfitShare
            await tx.investorCapitalTxn.deleteMany({ where: { tenant_id: tenantId } });
            await tx.assetDepreciationEntry.deleteMany({ where: { asset: { tenant_id: tenantId } } });
            await tx.salaryAccrual.deleteMany({ where: { tenant_id: tenantId } });
            // Depreciation entries are gone, so the running total on the asset is
            // no longer backed by anything.
            await tx.fixedAsset.updateMany({ where: { tenant_id: tenantId }, data: { accumulated_depreciation: 0 } });

            // Accounting journals
            await tx.voucher.deleteMany({ where: { tenant_id: tenantId } }); // cascades VoucherDetail, PostingEvent

            // Financials
            await tx.expenseEntry.deleteMany({ where: { tenant_id: tenantId } });
            await tx.loan.deleteMany({ where: { tenant_id: tenantId } }); // cascades LoanPayment
            await tx.salaryPayment.deleteMany({ where: { tenant_id: tenantId } });

            // HR operational
            await tx.attendanceRecord.deleteMany({ where: { tenant_id: tenantId } });
            await tx.leaveRequest.deleteMany({ where: { tenant_id: tenantId } });
            await tx.leaveBalance.deleteMany({ where: { tenant_id: tenantId } });
            await tx.payrollRun.deleteMany({ where: { tenant_id: tenantId } }); // cascades PayrollLine
            await tx.expenseClaim.deleteMany({ where: { tenant_id: tenantId } }); // cascades ExpenseClaimLine

            // In-app notices raised by the records above
            await tx.notification.deleteMany({ where: { tenant_id: tenantId } });

            // Storefront & sessions
            await tx.storefrontOrder.deleteMany({ where: { tenantId } }); // cascades StorefrontOrderItem
            await tx.cashierSession.deleteMany({ where: { tenant_id: tenantId } });

            // Serial inventory
            await tx.productSerial.deleteMany({ where: { tenant_id: tenantId } });

            if (mode === 'all') {
                // --- Master / reference data ---

                // Projects before Employee — a task may be assigned to one.
                await tx.project.deleteMany({ where: { tenant_id: tenantId } }); // cascades tasks, statuses, milestones
                await tx.supportThread.deleteMany({ where: { tenantId } }); // cascades SupportMessage

                // BOM before Products
                await tx.bomRecipe.deleteMany({ where: { tenantId } }); // cascades BomComponent, ProductionJob

                // Products and stock (after all transactional refs are gone)
                await tx.productStock.deleteMany({ where: { tenant_id: tenantId } });
                await tx.priceList.deleteMany({ where: { tenant_id: tenantId } }); // cascades PriceListItem

                // Customers and related groupings
                await tx.customer.deleteMany({ where: { tenant_id: tenantId } });
                await tx.customerGroup.deleteMany({ where: { tenant_id: tenantId } });
                await tx.territory.deleteMany({ where: { tenant_id: tenantId } });

                // CRM master data — safe here because Lead (which FKs these with
                // onDelete: Restrict) is already deleted above.
                await tx.leadSourceOption.deleteMany({ where: { tenant_id: tenantId } });
                await tx.leadCategoryOption.deleteMany({ where: { tenant_id: tenantId } });

                // Suppliers
                await tx.supplier.deleteMany({ where: { tenant_id: tenantId } });

                // Products — after stock, serials, BOM, and all sale/purchase items are gone
                await tx.product.deleteMany({ where: { tenant_id: tenantId } });
                await tx.brand.deleteMany({ where: { tenant_id: tenantId } });
                await tx.productSubgroup.deleteMany({ where: { tenant_id: tenantId } });
                await tx.productGroup.deleteMany({ where: { tenant_id: tenantId } });

                // CRM contacts (no dependents; captured business cards)
                await tx.crmContact.deleteMany({ where: { tenant_id: tenantId } });

                // HR master data (operational records deleted above). Employee
                // first: EmployeeSchedule cascades from it and would otherwise
                // block the work schedules.
                await tx.employee.deleteMany({ where: { tenant_id: tenantId } });
                await tx.designation.deleteMany({ where: { tenant_id: tenantId } });
                await tx.department.deleteMany({ where: { tenant_id: tenantId } });
                await tx.leaveType.deleteMany({ where: { tenant_id: tenantId } });
                await tx.workSchedule.deleteMany({ where: { tenant_id: tenantId } }); // cascades WorkScheduleDay
                await tx.holiday.deleteMany({ where: { tenant_id: tenantId } });

                // Finance master data (all journals and their sources are gone)
                await tx.investor.deleteMany({ where: { tenant_id: tenantId } });
                await tx.fixedAsset.deleteMany({ where: { tenant_id: tenantId } });
                await tx.accountBudget.deleteMany({ where: { tenant_id: tenantId } });
                await tx.costCenter.deleteMany({ where: { tenant_id: tenantId } });
                await tx.fiscalPeriod.deleteMany({ where: { tenant_id: tenantId } });

                // Inventory system data
                await tx.inventoryReason.deleteMany({ where: { tenant_id: tenantId } });

                // Discount codes
                await tx.discountCode.deleteMany({ where: { tenantId } });

                // Re-seed the CRM lead taxonomy. Unlike the other master data
                // cleared above, a tenant with no lead sources cannot classify a
                // new lead at all, so leaving these empty makes the CRM unusable
                // until the next container restart runs sync:lead-taxonomy.
                await seedDefaultLeadTaxonomy(tx, tenantId);
            }
        }, { timeout: 300_000, maxWait: 300_000 });

        return { cleared: mode };
    }

    async updateLocalizationSettings(tenantId: string, dto: UpdateLocalizationSettingsDto) {
        const tenant = await this.db.tenant.findUnique({
            where: { id: tenantId },
            select: {
                localization_enabled: true,
                secondary_locale: true,
            },
        });

        if (!tenant) {
            throw new NotFoundException('Tenant not found');
        }

        // The locale gate does not cover the timezone. A workspace that never
        // turns on a second language still has a working day, and getting it
        // wrong misfiles every "due today" and date-range filter in the product.
        if (dto.timezone !== undefined && !isValidTimeZone(dto.timezone)) {
            throw new BadRequestException(
                'Timezone must be an IANA zone name, for example "Asia/Dhaka".',
            );
        }

        if (dto.default_locale !== undefined && !tenant.localization_enabled) {
            throw new BadRequestException('Localization is not enabled for this tenant.');
        }

        const allowedLocales = new Set(['en']);
        if (tenant.secondary_locale) {
            allowedLocales.add(tenant.secondary_locale);
        }

        if (dto.default_locale !== undefined && !allowedLocales.has(dto.default_locale)) {
            throw new BadRequestException('Default locale is not enabled for this tenant.');
        }

        const data: Record<string, string> = {};
        if (dto.default_locale !== undefined) data.default_locale = dto.default_locale;
        if (dto.timezone !== undefined) data.timezone = dto.timezone;

        const updated = await this.db.tenant.update({
            where: { id: tenantId },
            data,
            select: {
                default_locale: true,
                localization_enabled: true,
                secondary_locale: true,
                timezone: true,
            },
        });

        // Otherwise the next few minutes of requests keep measuring the day in
        // the old zone, which reads as the setting not having saved.
        if (dto.timezone !== undefined) this.timezones.invalidate(tenantId);

        return updated;
    }
}
