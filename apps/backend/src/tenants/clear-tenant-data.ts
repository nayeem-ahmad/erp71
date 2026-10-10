import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { seedDefaultLeadTaxonomy } from '@erp71/database';
import type { DatabaseService } from '../database/database.service';
import { clearBranchTransactions } from './clear-branch-data';

type Tx = Prisma.TransactionClient;

export type ClearDataMode = 'transactions' | 'all';

/**
 * Prisma's default interactive-transaction timeout is 5s, which a store
 * carrying a full demo dataset (thousands of sales, vouchers and movements
 * across ~60 tables) blows straight through — the clear then fails mid-way and
 * rolls back, every time.
 */
const WIPE_TX_OPTIONS = { timeout: 300_000, maxWait: 300_000 };

/**
 * Wipe a tenant's transactions, or everything but its settings and users
 * (`all`) — or only one branch's transactions when `storeId` is given.
 *
 * Who may do this is the caller's business: the shop owner from Settings > Data
 * (`TenantsService.clearData`), or a platform admin from the tenant's Danger
 * Zone (`AdminTenantsService.clearTenantData`). Each wipe is one transaction, so
 * a half-cleared store is not a reachable state.
 */
export async function clearTenantData(
    db: DatabaseService,
    tenantId: string,
    mode: string,
    storeId?: string,
): Promise<{ cleared: ClearDataMode; storeId?: string; storeName?: string }> {
    if (mode !== 'transactions' && mode !== 'all') {
        throw new BadRequestException('mode must be "transactions" or "all"');
    }

    if (storeId) {
        // Products, customers, suppliers and the rest of the master data are
        // shared by every branch, so there is no "all data" of one branch to
        // clear — only its transactions.
        if (mode !== 'transactions') {
            throw new BadRequestException('Only transactions can be cleared for a single branch.');
        }
        const store = await db.store.findFirst({
            where: { id: storeId, tenant_id: tenantId },
            select: { id: true, name: true },
        });
        if (!store) throw new NotFoundException('Branch not found.');

        await db.$transaction((tx) => clearBranchTransactions(tx, tenantId, storeId), WIPE_TX_OPTIONS);
        return { cleared: mode, storeId, storeName: store.name };
    }

    await db.$transaction((tx) => wipeTenantData(tx, tenantId, mode), WIPE_TX_OPTIONS);
    return { cleared: mode };
}

async function wipeTenantData(tx: Tx, tenantId: string, mode: ClearDataMode): Promise<void> {
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
    await tx.purchase.deleteMany({ where: { tenant_id: tenantId } }); // cascades PurchaseItem, PurchasePayment
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
}
