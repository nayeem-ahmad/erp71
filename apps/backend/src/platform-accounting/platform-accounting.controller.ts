import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { PlatformFeatureGuard } from '../platform-settings/platform-feature.guard';
import { RequiresPlatformFeature } from '../platform-settings/platform-feature.decorator';
import {
    BalanceSheetQueryDto,
    ListAccountsQueryDto,
    ListLedgerQueryDto,
    ListVouchersQueryDto,
    ProfitLossQueryDto,
    TrialBalanceQueryDto,
} from '../accounting/accounting.dto';
import { PlatformAccountingService } from './platform-accounting.service';
import {
    CreatePlatformExpenseCategoryDto,
    CreatePlatformExpenseDto,
    ListPlatformExpensesQueryDto,
    PlatformAccountingOverviewQueryDto,
    SyncPlatformBillingDto,
    UpdatePlatformExpenseCategoryDto,
    UpdatePlatformExpenseDto,
} from './platform-accounting.dto';

type AdminRequest = { user: { userId: string }; tenantTimezone?: string };

/**
 * The platform's own accounting, in the admin console.
 *
 * Deliberately NOT mounted on `AccountingController`. That controller is a
 * tenant surface: `TenantInterceptor` requires a workspace header,
 * `SubscriptionAccessGuard` requires a plan that includes the accounting module,
 * and `StorePermissionGuard` requires a store. The platform has none of those —
 * it is not its own customer — so it gets its own routes, guarded the way every
 * other admin-console route is, and delegates to the same service underneath.
 */
@Controller('platform/accounting')
@UseGuards(JwtAuthGuard, PlatformAdminGuard, PlatformFeatureGuard)
@RequiresPlatformFeature('platformAccounting')
export class PlatformAccountingController {
    constructor(private readonly platformAccounting: PlatformAccountingService) {}

    @Get('overview')
    getOverview(@Request() req: AdminRequest, @Query() query: PlatformAccountingOverviewQueryDto) {
        return this.platformAccounting.getOverview(req.user.userId, query);
    }

    @Post('sync')
    sync(@Request() req: AdminRequest, @Body() dto: SyncPlatformBillingDto) {
        return this.platformAccounting.syncBillingEvents(req.user.userId, dto);
    }

    // ── Expenses ─────────────────────────────────────────────────────────────

    @Get('expenses')
    listExpenses(@Request() req: AdminRequest, @Query() query: ListPlatformExpensesQueryDto) {
        return this.platformAccounting.listExpenses(req.user.userId, query);
    }

    @Post('expenses')
    createExpense(@Request() req: AdminRequest, @Body() dto: CreatePlatformExpenseDto) {
        return this.platformAccounting.createExpense(req.user.userId, dto);
    }

    @Patch('expenses/:id')
    updateExpense(
        @Request() req: AdminRequest,
        @Param('id') id: string,
        @Body() dto: UpdatePlatformExpenseDto,
    ) {
        return this.platformAccounting.updateExpense(req.user.userId, id, dto);
    }

    @Delete('expenses/:id')
    deleteExpense(@Request() req: AdminRequest, @Param('id') id: string) {
        return this.platformAccounting.deleteExpense(req.user.userId, id);
    }

    // ── Expense categories ───────────────────────────────────────────────────

    @Get('expense-categories')
    listCategories(@Request() req: AdminRequest) {
        return this.platformAccounting.listCategories(req.user.userId);
    }

    @Post('expense-categories')
    createCategory(@Request() req: AdminRequest, @Body() dto: CreatePlatformExpenseCategoryDto) {
        return this.platformAccounting.createCategory(req.user.userId, dto);
    }

    @Patch('expense-categories/:id')
    updateCategory(
        @Request() req: AdminRequest,
        @Param('id') id: string,
        @Body() dto: UpdatePlatformExpenseCategoryDto,
    ) {
        return this.platformAccounting.updateCategory(req.user.userId, id, dto);
    }

    @Delete('expense-categories/:id')
    deleteCategory(@Request() req: AdminRequest, @Param('id') id: string) {
        return this.platformAccounting.deleteCategory(req.user.userId, id);
    }

    // ── Chart of accounts and the ledger ─────────────────────────────────────

    @Get('accounts')
    listAccounts(@Request() req: AdminRequest, @Query() query: ListAccountsQueryDto) {
        return this.platformAccounting.getAccounts(req.user.userId, query);
    }

    @Get('account-groups')
    listAccountGroups(@Request() req: AdminRequest) {
        return this.platformAccounting.getAccountGroups(req.user.userId);
    }

    @Get('vouchers')
    listVouchers(@Request() req: AdminRequest, @Query() query: ListVouchersQueryDto) {
        // `findVouchers` needs a timezone to bound `createdFrom`/`createdTo`.
        // The admin console runs without a workspace, so there is no tenant
        // timezone to take: the platform books are kept in Dhaka time, which is
        // where the business is.
        return this.platformAccounting.getVouchers(req.user.userId, { ...query, timezone: 'Asia/Dhaka' });
    }

    @Get('ledger/:accountId')
    getLedger(
        @Request() req: AdminRequest,
        @Param('accountId') accountId: string,
        @Query() query: ListLedgerQueryDto,
    ) {
        return this.platformAccounting.getLedger(req.user.userId, accountId, query);
    }

    // ── Financial statements ─────────────────────────────────────────────────

    @Get('reports/profit-loss')
    getProfitLoss(@Request() req: AdminRequest, @Query() query: ProfitLossQueryDto) {
        return this.platformAccounting.getProfitLoss(req.user.userId, query);
    }

    @Get('reports/balance-sheet')
    getBalanceSheet(@Request() req: AdminRequest, @Query() query: BalanceSheetQueryDto) {
        return this.platformAccounting.getBalanceSheet(req.user.userId, query);
    }

    @Get('reports/trial-balance')
    getTrialBalance(@Request() req: AdminRequest, @Query() query: TrialBalanceQueryDto) {
        return this.platformAccounting.getTrialBalance(req.user.userId, query);
    }
}
