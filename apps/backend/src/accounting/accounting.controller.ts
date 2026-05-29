import { Body, Controller, Get, Header, Param, Patch, Post, Query, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import { Response } from 'express';
import { AccountingService } from './accounting.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequiresFeature } from '../auth/subscription-access.decorator';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { TenantRoleGuard } from '../auth/tenant-role.guard';
import { TenantRoles } from '../auth/tenant-roles.decorator';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import {
    CreateVoucherDto,
    CreateAccountDto,
    CreateAccountGroupDto,
    CreateAccountSubgroupDto,
    ExportLedgerQueryDto,
    FinancialKpiQueryDto,
    FinancialTrendQueryDto,
    ListAccountsQueryDto,
    ListLedgerQueryDto,
    ListAccountSubgroupsQueryDto,
    ListVouchersQueryDto,
    VoucherNumberPreviewQueryDto,
    ListPostingRulesQueryDto,
    UpdatePostingRuleDto,
    ListPostingExceptionsQueryDto,
    ProfitLossQueryDto,
    BalanceSheetQueryDto,
    CashbookQueryDto,
    BankbookQueryDto,
} from './accounting.dto';

@Controller('accounting')
@UseGuards(JwtAuthGuard, TenantRoleGuard, SubscriptionAccessGuard)
@UseInterceptors(TenantInterceptor)
@TenantRoles('OWNER', 'MANAGER', 'ACCOUNTANT')
@RequiresFeature('premiumAccounting')
export class AccountingController {
    constructor(private readonly accountingService: AccountingService) {}

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

    @Post('account-groups')
    createAccountGroup(@Tenant() tenant: TenantContext, @Body() dto: CreateAccountGroupDto) {
        return this.accountingService.createAccountGroup(tenant.tenantId, dto);
    }

    @Get('account-subgroups')
    findAccountSubgroups(
        @Tenant() tenant: TenantContext,
        @Query() query: ListAccountSubgroupsQueryDto,
    ) {
        return this.accountingService.findAccountSubgroups(tenant.tenantId, query);
    }

    @Post('account-subgroups')
    createAccountSubgroup(@Tenant() tenant: TenantContext, @Body() dto: CreateAccountSubgroupDto) {
        return this.accountingService.createAccountSubgroup(tenant.tenantId, dto);
    }

    @Get('accounts')
    findAccounts(@Tenant() tenant: TenantContext, @Query() query: ListAccountsQueryDto) {
        return this.accountingService.findAccounts(tenant.tenantId, query);
    }

    @Post('accounts')
    createAccount(@Tenant() tenant: TenantContext, @Body() dto: CreateAccountDto) {
        return this.accountingService.createAccount(tenant.tenantId, dto);
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

    @Get('vouchers/:id')
    findVoucherById(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.accountingService.findVoucherById(tenant.tenantId, id);
    }

    @Post('vouchers')
    createVoucher(@Tenant() tenant: TenantContext, @Body() dto: CreateVoucherDto) {
        return this.accountingService.createVoucher(tenant.tenantId, dto);
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
    getProfitLoss(@Tenant() tenant: TenantContext, @Query() query: ProfitLossQueryDto) {
        return this.accountingService.getProfitLoss(tenant.tenantId, query);
    }

    @Get('reports/balance-sheet')
    getBalanceSheet(@Tenant() tenant: TenantContext, @Query() query: BalanceSheetQueryDto) {
        return this.accountingService.getBalanceSheet(tenant.tenantId, query);
    }

    @Get('reports/cashbook')
    getCashbook(@Tenant() tenant: TenantContext, @Query() query: CashbookQueryDto) {
        return this.accountingService.getCashbook(tenant.tenantId, query);
    }

    @Get('reports/bankbook')
    getBankbook(@Tenant() tenant: TenantContext, @Query() query: BankbookQueryDto) {
        return this.accountingService.getBankbook(tenant.tenantId, query);
    }
}