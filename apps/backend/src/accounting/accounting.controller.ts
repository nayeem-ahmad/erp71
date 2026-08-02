import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Query, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import { Response } from 'express';
import { StorePermission } from '@erp71/shared-types';
import { AccountingService } from './accounting.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { hasStorePermission } from '../auth/permission.util';
import { RequiresAdditionalFeature, RequiresFeature } from '../auth/subscription-access.decorator';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { RequireStorePermission } from '../auth/store-permission.decorator';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { TenantRoleGuard } from '../auth/tenant-role.guard';
import { TenantRoles } from '../auth/tenant-roles.decorator';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { DatabaseService } from '../database/database.service';
import {
    CreateVoucherDto,
    CreateAccountDto,
    CreateAccountGroupDto,
    CreateAccountSubgroupDto,
    NextAccountCodeQueryDto,
    NextAccountGroupCodeQueryDto,
    NextAccountSubgroupCodeQueryDto,
    UpdateAccountDto,
    UpdateAccountGroupDto,
    UpdateAccountSubgroupDto,
    AccountingOverviewQueryDto,
    ExportLedgerQueryDto,
    FinancialKpiQueryDto,
    FinancialTrendQueryDto,
    ListAccountsQueryDto,
    ListLedgerQueryDto,
    ListAccountSubgroupsQueryDto,
    BulkVoucherApprovalDto,
    ListVouchersQueryDto,
    RejectVoucherDto,
    UpdateAccountingSettingsDto,
    VoucherNumberPreviewQueryDto,
    ListPostingRulesQueryDto,
    UpdatePostingRuleDto,
    ListPostingExceptionsQueryDto,
    ProfitLossQueryDto,
    BalanceSheetQueryDto,
    CashbookQueryDto,
    BankbookQueryDto,
    TrialBalanceQueryDto,
    ArAgingQueryDto,
    ApAgingQueryDto,
    ComparativePLQueryDto,
    VatTaxReportQueryDto,
    FinancialRatiosQueryDto,
    CashFlowQueryDto,
    FiscalPeriodsQueryDto,
    LockFiscalPeriodDto,
    ImportOpeningBalancesDto,
    UpsertBudgetDto,
    BudgetVsActualQueryDto,
    CreateCostCenterDto,
    CostCenterPLQueryDto,
    CreateFixedAssetDto,
    RunDepreciationDto,
    CreateRecurringJournalDto,
    CreateRecurringVoucherDto,
    ListRecurringVouchersQueryDto,
    CreateVoucherTemplateDto,
    ListVoucherTemplatesQueryDto,
    CreateBankReconciliationDto,
    ImportBankStatementDto,
    MatchBankEntryDto,
} from './accounting.dto';

@Controller('accounting')
@UseGuards(JwtAuthGuard, StorePermissionGuard, TenantRoleGuard, SubscriptionAccessGuard)
@UseInterceptors(TenantInterceptor)
@RequireStorePermission(StorePermission.VIEW_LEDGER)
@RequiresFeature('premiumAccounting')
export class AccountingController {
    constructor(
        private readonly accountingService: AccountingService,
        private readonly db: DatabaseService,
    ) {}

    @Get()
    getOverview(@Tenant() tenant: TenantContext) {
        return this.accountingService.getModuleOverview(tenant.tenantId);
    }

    @Get('export')
    async exportLedger(
        @Tenant() tenant: TenantContext,
        @Query() query: ExportLedgerQueryDto,
        @Res() res: Response,
    ) {
        const content = await this.accountingService.exportLedger(
            tenant.tenantId,
            query.format,
            query.from,
            query.to,
        );

        const fromLabel = query.from ?? 'all';
        const toLabel = query.to ?? 'all';

        if (query.format === 'tally') {
            res.setHeader('Content-Type', 'application/xml; charset=utf-8');
            res.setHeader(
                'Content-Disposition',
                `attachment; filename="tally-export-${fromLabel}-${toLabel}.xml"`,
            );
        } else {
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader(
                'Content-Disposition',
                `attachment; filename="quickbooks-export-${fromLabel}-${toLabel}.iif"`,
            );
        }

        res.send(content);
    }

    @Get('account-groups')
    findAccountGroups(@Tenant() tenant: TenantContext) {
        return this.accountingService.findAccountGroups(tenant.tenantId);
    }

    @Get('account-groups/next-code')
    nextAccountGroupCode(
        @Tenant() tenant: TenantContext,
        @Query() query: NextAccountGroupCodeQueryDto,
    ) {
        return this.accountingService.nextAccountGroupCode(tenant.tenantId, query.type);
    }

    @Post('account-groups')
    createAccountGroup(@Tenant() tenant: TenantContext, @Body() dto: CreateAccountGroupDto) {
        return this.accountingService.createAccountGroup(tenant.tenantId, dto);
    }

    @Patch('account-groups/:id')
    updateAccountGroup(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdateAccountGroupDto,
    ) {
        return this.accountingService.updateAccountGroup(tenant.tenantId, id, dto);
    }

    @Delete('account-groups/:id')
    deleteAccountGroup(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.accountingService.deleteAccountGroup(tenant.tenantId, id);
    }

    @Get('account-subgroups')
    findAccountSubgroups(
        @Tenant() tenant: TenantContext,
        @Query() query: ListAccountSubgroupsQueryDto,
    ) {
        return this.accountingService.findAccountSubgroups(tenant.tenantId, query);
    }

    @Get('account-subgroups/next-code')
    nextAccountSubgroupCode(
        @Tenant() tenant: TenantContext,
        @Query() query: NextAccountSubgroupCodeQueryDto,
    ) {
        return this.accountingService.nextAccountSubgroupCode(tenant.tenantId, query.groupId);
    }

    @Post('account-subgroups')
    createAccountSubgroup(@Tenant() tenant: TenantContext, @Body() dto: CreateAccountSubgroupDto) {
        return this.accountingService.createAccountSubgroup(tenant.tenantId, dto);
    }

    @Patch('account-subgroups/:id')
    updateAccountSubgroup(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdateAccountSubgroupDto,
    ) {
        return this.accountingService.updateAccountSubgroup(tenant.tenantId, id, dto);
    }

    @Delete('account-subgroups/:id')
    deleteAccountSubgroup(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.accountingService.deleteAccountSubgroup(tenant.tenantId, id);
    }

    @Get('accounts')
    findAccounts(@Tenant() tenant: TenantContext, @Query() query: ListAccountsQueryDto) {
        return this.accountingService.findAccounts(tenant.tenantId, query);
    }

    @Get('accounts/next-code')
    nextAccountCode(@Tenant() tenant: TenantContext, @Query() query: NextAccountCodeQueryDto) {
        return this.accountingService.nextAccountCodeFor(
            tenant.tenantId,
            query.groupId,
            query.subgroupId,
        );
    }

    @Post('accounts')
    createAccount(@Tenant() tenant: TenantContext, @Body() dto: CreateAccountDto) {
        return this.accountingService.createAccount(tenant.tenantId, dto);
    }

    @Patch('accounts/:id')
    updateAccount(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdateAccountDto,
    ) {
        return this.accountingService.updateAccount(tenant.tenantId, id, dto);
    }

    @Delete('accounts/:id')
    deleteAccount(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.accountingService.deleteAccount(tenant.tenantId, id);
    }

    @Get('vouchers')
    findVouchers(@Tenant() tenant: TenantContext, @Query() query: ListVouchersQueryDto) {
        return this.accountingService.findVouchers(tenant.tenantId, query);
    }

    @Get('vouchers/next-number')
    getVoucherNumberPreview(
        @Tenant() tenant: TenantContext,
        @Query() query: VoucherNumberPreviewQueryDto,
    ) {
        return this.accountingService.getVoucherNumberPreview(tenant.tenantId, query.voucherType);
    }

    /** Drives the sidebar approval-queue badge; polled, so kept deliberately cheap. */
    @Get('vouchers/pending-count')
    getPendingVoucherCount(@Tenant() tenant: TenantContext) {
        return this.accountingService.getPendingVoucherCount(tenant.tenantId);
    }

    @Get('vouchers/:id')
    findVoucherById(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.accountingService.findVoucherById(tenant.tenantId, id);
    }

    @Post('vouchers')
    createVoucher(@Tenant() tenant: TenantContext, @Body() dto: CreateVoucherDto) {
        return this.accountingService.createVoucher(tenant.tenantId, dto, 1, tenant.userId);
    }

    @Patch('vouchers/:id')
    updateVoucher(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: CreateVoucherDto) {
        return this.accountingService.updateVoucher(tenant.tenantId, id, dto, tenant.userId);
    }

    @Delete('vouchers/:id')
    deleteVoucher(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.accountingService.deleteVoucher(tenant.tenantId, id, tenant.userId);
    }

    @Post('vouchers/bulk-approve')
    @RequireStorePermission(StorePermission.VIEW_LEDGER, StorePermission.APPROVE_VOUCHER)
    bulkApproveVouchers(@Tenant() tenant: TenantContext, @Body() dto: BulkVoucherApprovalDto) {
        return this.accountingService.bulkUpdateVoucherApproval(tenant.tenantId, dto, 'approve', tenant.userId);
    }

    @Post('vouchers/bulk-reject')
    @RequireStorePermission(StorePermission.VIEW_LEDGER, StorePermission.APPROVE_VOUCHER)
    bulkRejectVouchers(@Tenant() tenant: TenantContext, @Body() dto: BulkVoucherApprovalDto) {
        return this.accountingService.bulkUpdateVoucherApproval(tenant.tenantId, dto, 'reject', tenant.userId);
    }

    @Post('vouchers/:id/approve')
    @RequireStorePermission(StorePermission.VIEW_LEDGER, StorePermission.APPROVE_VOUCHER)
    approveVoucher(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.accountingService.approveVoucher(tenant.tenantId, id, tenant.userId);
    }

    @Post('vouchers/:id/reject')
    @RequireStorePermission(StorePermission.VIEW_LEDGER, StorePermission.APPROVE_VOUCHER)
    rejectVoucher(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: RejectVoucherDto,
    ) {
        return this.accountingService.rejectVoucher(tenant.tenantId, id, dto, tenant.userId);
    }

    /**
     * Readable by anyone who can see the ledger — the voucher UI needs to know
     * whether approval is on — but only the owner sets the policy.
     */
    @Get('settings/accounting')
    getAccountingSettings(@Tenant() tenant: TenantContext) {
        return this.accountingService.getAccountingSettings(tenant.tenantId);
    }

    @Patch('settings/accounting')
    @TenantRoles('OWNER')
    updateAccountingSettings(
        @Tenant() tenant: TenantContext,
        @Body() dto: UpdateAccountingSettingsDto,
    ) {
        return this.accountingService.updateAccountingSettings(tenant.tenantId, dto, tenant.userId);
    }

    @Get('dashboard/overview')
    getAccountingDashboardOverview(
        @Tenant() tenant: TenantContext,
        @Query() query: AccountingOverviewQueryDto,
    ) {
        return this.accountingService.getAccountingDashboardOverview(tenant.tenantId, query);
    }

    @Get('dashboard/kpis')
    getFinancialKpis(@Tenant() tenant: TenantContext, @Query() query: FinancialKpiQueryDto) {
        return this.accountingService.getFinancialKpis(tenant.tenantId, query);
    }

    @Get('dashboard/trends')
    getFinancialTrends(@Tenant() tenant: TenantContext, @Query() query: FinancialTrendQueryDto) {
        return this.accountingService.getFinancialTrends(tenant.tenantId, query);
    }

    @Get('settings/posting-rules')
    listPostingRules(@Tenant() tenant: TenantContext, @Query() query: ListPostingRulesQueryDto) {
        return this.accountingService.listPostingRules(tenant.tenantId, query);
    }

    @Patch('settings/posting-rules/:id')
    @TenantRoles('OWNER', 'ACCOUNTANT')
    updatePostingRule(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdatePostingRuleDto,
    ) {
        return this.accountingService.updatePostingRule(tenant.tenantId, id, dto);
    }

    @Get('reconciliation/posting-exceptions')
    listPostingExceptions(
        @Tenant() tenant: TenantContext,
        @Query() query: ListPostingExceptionsQueryDto,
    ) {
        return this.accountingService.listPostingExceptions(tenant.tenantId, query);
    }

    @Post('reconciliation/posting-exceptions/:id/retry')
    @TenantRoles('OWNER', 'ACCOUNTANT')
    retryPostingException(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.accountingService.retryPostingException(tenant.tenantId, id);
    }

    @Get('reports/ledger/:accountId')
    findLedger(
        @Tenant() tenant: TenantContext,
        @Param('accountId') accountId: string,
        @Query() query: ListLedgerQueryDto,
    ) {
        return this.accountingService.findLedger(tenant.tenantId, accountId, query);
    }

    @Get('reports/profit-loss')
    async getProfitLoss(@Tenant() tenant: TenantContext, @Query() query: ProfitLossQueryDto) {
        const hasConsolidatedAccess = await hasStorePermission(this.db, tenant, StorePermission.VIEW_CONSOLIDATED_REPORTS);
        return this.accountingService.getProfitLoss(tenant.tenantId, query, hasConsolidatedAccess);
    }

    @Get('reports/balance-sheet')
    async getBalanceSheet(@Tenant() tenant: TenantContext, @Query() query: BalanceSheetQueryDto) {
        const hasConsolidatedAccess = await hasStorePermission(this.db, tenant, StorePermission.VIEW_CONSOLIDATED_REPORTS);
        return this.accountingService.getBalanceSheet(tenant.tenantId, query, hasConsolidatedAccess);
    }

    @Get('reports/cashbook')
    getCashbook(@Tenant() tenant: TenantContext, @Query() query: CashbookQueryDto) {
        return this.accountingService.getCashbook(tenant.tenantId, query);
    }

    @Get('reports/bankbook')
    getBankbook(@Tenant() tenant: TenantContext, @Query() query: BankbookQueryDto) {
        return this.accountingService.getBankbook(tenant.tenantId, query);
    }

    @Get('reports/trial-balance')
    async getTrialBalance(@Tenant() tenant: TenantContext, @Query() query: TrialBalanceQueryDto) {
        const hasConsolidatedAccess = await hasStorePermission(this.db, tenant, StorePermission.VIEW_CONSOLIDATED_REPORTS);
        return this.accountingService.getTrialBalance(tenant.tenantId, query, hasConsolidatedAccess);
    }

    @Get('reports/ar-aging')
    getArAging(@Tenant() tenant: TenantContext, @Query() query: ArAgingQueryDto) {
        return this.accountingService.getArAging(tenant.tenantId, query);
    }

    @Get('reports/ap-aging')
    getApAging(@Tenant() tenant: TenantContext, @Query() query: ApAgingQueryDto) {
        return this.accountingService.getApAging(tenant.tenantId, query);
    }

    @Get('reports/comparative-pl')
    @RequiresAdditionalFeature('premiumAccountingAdvanced')
    getComparativePL(@Tenant() tenant: TenantContext, @Query() query: ComparativePLQueryDto) {
        return this.accountingService.getComparativePL(tenant.tenantId, query);
    }

    @Get('reports/vat-tax')
    getVatTaxReport(@Tenant() tenant: TenantContext, @Query() query: VatTaxReportQueryDto) {
        return this.accountingService.getVatTaxReport(tenant.tenantId, query);
    }

    @Get('reports/financial-ratios')
    @RequiresAdditionalFeature('premiumAccountingAdvanced')
    getFinancialRatios(@Tenant() tenant: TenantContext, @Query() query: FinancialRatiosQueryDto) {
        return this.accountingService.getFinancialRatios(tenant.tenantId, query);
    }

    @Get('reports/cash-flow')
    @RequiresAdditionalFeature('premiumAccountingAdvanced')
    getCashFlow(@Tenant() tenant: TenantContext, @Query() query: CashFlowQueryDto) {
        return this.accountingService.getCashFlow(tenant.tenantId, query);
    }

    // Feature 8: Fiscal Period Locking
    @Get('settings/fiscal-periods')
    listFiscalPeriods(@Tenant() tenant: TenantContext, @Query() query: FiscalPeriodsQueryDto) {
        return this.accountingService.listFiscalPeriods(tenant.tenantId, query);
    }

    @Post('settings/fiscal-periods/lock')
    @TenantRoles('OWNER', 'ACCOUNTANT')
    lockFiscalPeriod(@Tenant() tenant: TenantContext, @Body() dto: LockFiscalPeriodDto) {
        return this.accountingService.lockFiscalPeriod(tenant.tenantId, dto, tenant.userId);
    }

    @Post('settings/fiscal-periods/unlock')
    @TenantRoles('OWNER')
    unlockFiscalPeriod(@Tenant() tenant: TenantContext, @Body() dto: LockFiscalPeriodDto) {
        return this.accountingService.unlockFiscalPeriod(tenant.tenantId, dto, tenant.userId);
    }

    // Feature 9: Opening Balance Import
    @Post('opening-balances')
    @TenantRoles('OWNER', 'ACCOUNTANT')
    importOpeningBalances(@Tenant() tenant: TenantContext, @Body() dto: ImportOpeningBalancesDto) {
        return this.accountingService.importOpeningBalances(tenant.tenantId, dto);
    }

    // Feature 10: Budget vs Actual
    @Post('budgets')
    @TenantRoles('OWNER', 'ACCOUNTANT')
    @RequiresAdditionalFeature('premiumAccountingAdvanced')
    upsertBudget(@Tenant() tenant: TenantContext, @Body() dto: UpsertBudgetDto) {
        return this.accountingService.upsertBudget(tenant.tenantId, dto);
    }

    @Get('reports/budget-vs-actual')
    @RequiresAdditionalFeature('premiumAccountingAdvanced')
    getBudgetVsActual(@Tenant() tenant: TenantContext, @Query() query: BudgetVsActualQueryDto) {
        return this.accountingService.getBudgetVsActual(tenant.tenantId, query);
    }

    // Feature 11: Cost Centers
    @Get('cost-centers')
    listCostCenters(@Tenant() tenant: TenantContext) {
        return this.accountingService.listCostCenters(tenant.tenantId);
    }

    @Post('cost-centers')
    @TenantRoles('OWNER', 'ACCOUNTANT')
    createCostCenter(@Tenant() tenant: TenantContext, @Body() dto: CreateCostCenterDto) {
        return this.accountingService.createCostCenter(tenant.tenantId, dto);
    }

    @Get('reports/cost-center-pl')
    getCostCenterPL(@Tenant() tenant: TenantContext, @Query() query: CostCenterPLQueryDto) {
        return this.accountingService.getCostCenterPL(tenant.tenantId, query);
    }

    // Feature 12: Fixed Assets
    @Get('fixed-assets')
    listFixedAssets(@Tenant() tenant: TenantContext) {
        return this.accountingService.listFixedAssets(tenant.tenantId);
    }

    @Post('fixed-assets')
    @TenantRoles('OWNER', 'ACCOUNTANT')
    createFixedAsset(@Tenant() tenant: TenantContext, @Body() dto: CreateFixedAssetDto) {
        return this.accountingService.createFixedAsset(tenant.tenantId, dto);
    }

    @Post('fixed-assets/run-depreciation')
    @TenantRoles('OWNER', 'ACCOUNTANT')
    runDepreciation(@Tenant() tenant: TenantContext, @Body() dto: RunDepreciationDto) {
        return this.accountingService.runDepreciation(tenant.tenantId, dto);
    }

    @Get('fixed-assets/:id/schedule')
    getDepreciationSchedule(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.accountingService.getDepreciationSchedule(tenant.tenantId, id);
    }

    // Feature 13: Recurring Journals
    @Get('recurring-journals')
    listRecurringJournals(@Tenant() tenant: TenantContext) {
        return this.accountingService.listRecurringJournals(tenant.tenantId);
    }

    @Post('recurring-journals')
    @TenantRoles('OWNER', 'ACCOUNTANT')
    createRecurringJournal(@Tenant() tenant: TenantContext, @Body() dto: CreateRecurringJournalDto) {
        return this.accountingService.createRecurringJournal(tenant.tenantId, dto);
    }

    @Post('recurring-journals/:id/post')
    @TenantRoles('OWNER', 'ACCOUNTANT')
    postRecurringJournal(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.accountingService.postRecurringJournal(tenant.tenantId, id);
    }

    // Recurring Vouchers: schedule any voucher type (cash/bank/journal) to auto-generate
    @Get('recurring-vouchers')
    listRecurringVouchers(@Tenant() tenant: TenantContext, @Query() query: ListRecurringVouchersQueryDto) {
        return this.accountingService.listRecurringVouchers(tenant.tenantId, query.voucherType);
    }

    @Post('recurring-vouchers')
    @TenantRoles('OWNER', 'ACCOUNTANT')
    createRecurringVoucher(@Tenant() tenant: TenantContext, @Body() dto: CreateRecurringVoucherDto) {
        return this.accountingService.createRecurringVoucher(tenant.tenantId, dto);
    }

    @Post('recurring-vouchers/:id/post')
    @TenantRoles('OWNER', 'ACCOUNTANT')
    postRecurringVoucher(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.accountingService.postRecurringVoucher(tenant.tenantId, id);
    }

    @Delete('recurring-vouchers/:id')
    @TenantRoles('OWNER', 'ACCOUNTANT')
    deleteRecurringVoucher(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.accountingService.deleteRecurringVoucher(tenant.tenantId, id);
    }

    // Voucher Templates: reusable named line templates for quick voucher entry
    @Get('voucher-templates')
    listVoucherTemplates(@Tenant() tenant: TenantContext, @Query() query: ListVoucherTemplatesQueryDto) {
        return this.accountingService.listVoucherTemplates(tenant.tenantId, query.voucherType);
    }

    @Get('voucher-templates/:id')
    getVoucherTemplate(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.accountingService.getVoucherTemplate(tenant.tenantId, id);
    }

    @Post('voucher-templates')
    @TenantRoles('OWNER', 'ACCOUNTANT')
    createVoucherTemplate(@Tenant() tenant: TenantContext, @Body() dto: CreateVoucherTemplateDto) {
        return this.accountingService.createVoucherTemplate(tenant.tenantId, dto);
    }

    @Delete('voucher-templates/:id')
    @TenantRoles('OWNER', 'ACCOUNTANT')
    deleteVoucherTemplate(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.accountingService.deleteVoucherTemplate(tenant.tenantId, id);
    }

    // Feature 14: Bank Reconciliation
    @Post('bank-reconciliations')
    @TenantRoles('OWNER', 'ACCOUNTANT')
    createBankReconciliation(@Tenant() tenant: TenantContext, @Body() dto: CreateBankReconciliationDto) {
        return this.accountingService.createBankReconciliation(tenant.tenantId, dto);
    }

    @Post('bank-reconciliations/import')
    @TenantRoles('OWNER', 'ACCOUNTANT')
    importBankStatementEntries(@Tenant() tenant: TenantContext, @Body() dto: ImportBankStatementDto) {
        return this.accountingService.importBankStatementEntries(tenant.tenantId, dto);
    }

    @Post('bank-reconciliations/:id/auto-match')
    @TenantRoles('OWNER', 'ACCOUNTANT')
    autoMatchBankEntries(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.accountingService.autoMatchBankEntries(tenant.tenantId, id);
    }

    @Post('bank-reconciliations/match-entry')
    @TenantRoles('OWNER', 'ACCOUNTANT')
    matchBankEntry(@Tenant() tenant: TenantContext, @Body() dto: MatchBankEntryDto) {
        return this.accountingService.matchBankEntry(tenant.tenantId, dto);
    }

    @Get('bank-reconciliations/:id/report')
    getBankReconciliationReport(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.accountingService.getBankReconciliationReport(tenant.tenantId, id);
    }
}