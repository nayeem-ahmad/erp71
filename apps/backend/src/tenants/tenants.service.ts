import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { StorefrontSettingsDto } from '../storefront/storefront.dto';
import { UpdateBrandingDto } from './update-branding.dto';
import { UpdateLocalizationSettingsDto } from './localization-settings.dto';

@Injectable()
export class TenantsService {
    constructor(private readonly db: DatabaseService) {}

    async updateStorefrontSettings(tenantId: string, dto: StorefrontSettingsDto) {
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
            },
        });
    }

    async clearData(tenantId: string, mode: 'transactions' | 'all', userRole: string | undefined) {
        if (userRole !== 'OWNER') throw new ForbiddenException('Only the shop owner can clear data');
        if (mode !== 'transactions' && mode !== 'all') {
            throw new BadRequestException('mode must be "transactions" or "all"');
        }

        await this.db.$transaction(async (tx) => {
            // --- Transactional / operational records ---

            // Demo-data batch history (metadata; both modes reset the append counter)
            await tx.demoDataBatch.deleteMany({ where: { tenant_id: tenantId } });

            // CRM operational (before Customer)
            await tx.lead.deleteMany({ where: { tenant_id: tenantId } }); // cascades LeadConversation
            await tx.crmTask.deleteMany({ where: { tenant_id: tenantId } });
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

            // Inventory operational
            await tx.productionJob.deleteMany({ where: { tenantId } });
            await tx.inventoryMovement.deleteMany({ where: { tenant_id: tenantId } });
            await tx.inventoryShrinkage.deleteMany({ where: { tenant_id: tenantId } }); // cascades InventoryShrinkageItem
            await tx.warehouseTransfer.deleteMany({ where: { tenant_id: tenantId } }); // cascades WarehouseTransferItem
            await tx.stockTakeSession.deleteMany({ where: { tenant_id: tenantId } }); // cascades StockTakeCountLine

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

            // Storefront & sessions
            await tx.storefrontOrder.deleteMany({ where: { tenantId } }); // cascades StorefrontOrderItem
            await tx.cashierSession.deleteMany({ where: { tenant_id: tenantId } });

            // Serial inventory
            await tx.productSerial.deleteMany({ where: { tenant_id: tenantId } });

            if (mode === 'all') {
                // --- Master / reference data ---

                // BOM before Products
                await tx.bomRecipe.deleteMany({ where: { tenantId } }); // cascades BomComponent, ProductionJob

                // Products and stock (after all transactional refs are gone)
                await tx.productStock.deleteMany({ where: { tenant_id: tenantId } });
                await tx.priceList.deleteMany({ where: { tenant_id: tenantId } }); // cascades PriceListItem

                // Customers and related groupings
                await tx.customer.deleteMany({ where: { tenant_id: tenantId } });
                await tx.customerGroup.deleteMany({ where: { tenant_id: tenantId } });
                await tx.territory.deleteMany({ where: { tenant_id: tenantId } });

                // Suppliers
                await tx.supplier.deleteMany({ where: { tenant_id: tenantId } });

                // Products — after stock, serials, BOM, and all sale/purchase items are gone
                await tx.product.deleteMany({ where: { tenant_id: tenantId } });
                await tx.brand.deleteMany({ where: { tenant_id: tenantId } });
                await tx.productSubgroup.deleteMany({ where: { tenant_id: tenantId } });
                await tx.productGroup.deleteMany({ where: { tenant_id: tenantId } });

                // HR master data (operational records deleted above)
                await tx.employee.deleteMany({ where: { tenant_id: tenantId } });
                await tx.designation.deleteMany({ where: { tenant_id: tenantId } });
                await tx.department.deleteMany({ where: { tenant_id: tenantId } });
                await tx.leaveType.deleteMany({ where: { tenant_id: tenantId } });

                // Inventory system data
                await tx.inventoryReason.deleteMany({ where: { tenant_id: tenantId } });

                // Discount codes
                await tx.discountCode.deleteMany({ where: { tenantId } });
            }
        });

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

        if (!tenant.localization_enabled) {
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

        return this.db.tenant.update({
            where: { id: tenantId },
            data,
            select: {
                default_locale: true,
                localization_enabled: true,
                secondary_locale: true,
            },
        });
    }
}
