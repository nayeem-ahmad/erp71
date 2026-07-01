import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import { AccountCategory, AccountType, VoucherType } from './accounting.constants';
import { AuditService } from '../audit/audit.service';
import { JobTrackerService } from '../system-health/jobs/job-tracker.service';
import { JOB_NAMES } from '../system-health/jobs/job-names';
import {
    CreateVoucherDto,
    CreateAccountDto,
    CreateAccountGroupDto,
    CreateAccountSubgroupDto,
    FinancialKpiQueryDto,
    FinancialTrendQueryDto,
    ListAccountsQueryDto,
    ListLedgerQueryDto,
    ListAccountSubgroupsQueryDto,
    ListVouchersQueryDto,
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
    CreateVoucherTemplateDto,
    CreateBankReconciliationDto,
    ImportBankStatementDto,
    MatchBankEntryDto,
} from './accounting.dto';

export const VOUCHER_NUMBER_PREFIXES: Record<VoucherType, string> = {
    [VoucherType.CASH_PAYMENT]: 'CP',
    [VoucherType.CASH_RECEIVE]: 'CR',
    [VoucherType.BANK_PAYMENT]: 'BP',
    [VoucherType.BANK_RECEIVE]: 'BR',
    [VoucherType.FUND_TRANSFER]: 'FT',
    [VoucherType.JOURNAL]: 'JV',
};

export const VOUCHER_NUMBER_PADDING = 5;

const CREDIT_NORMAL_ACCOUNT_TYPES = new Set<AccountType>([
    AccountType.LIABILITY,
    AccountType.EQUITY,
    AccountType.REVENUE,
]);

const RECEIVABLE_ACCOUNT_PATTERN = /(accounts?\s+receivable|receivable|a\/r)/i;
const PAYABLE_ACCOUNT_PATTERN = /(accounts?\s+payable|payable|a\/p)/i;
const TAX_LIABILITY_ACCOUNT_PATTERN = /(tax|vat|gst|sales\s+tax|withholding)/i;

@Injectable()
export class AccountingService {
    private readonly logger = new Logger(AccountingService.name);

    constructor(
        private readonly db: DatabaseService,
        private readonly auditService: AuditService,
        private readonly jobTracker: JobTrackerService,
    ) {}

    getModuleOverview(tenantId: string) {
        return {
            tenantId,
            module: 'accounting',
            routes: {
                accounts: '/accounting/accounts',
                vouchers: '/accounting/vouchers',
                voucherNumberPreview: '/accounting/vouchers/next-number',
                dashboardKpis: '/accounting/dashboard/kpis',
                dashboardTrends: '/accounting/dashboard/trends',
                ledger: '/accounting/reports/ledger',
            },
            constants: {
                accountTypes: Object.values(AccountType),
                accountCategories: Object.values(AccountCategory),
                voucherTypes: Object.values(VoucherType),
            },
        };
    }

    async createAccountGroup(tenantId: string, dto: CreateAccountGroupDto) {
        const existing = await this.db.accountGroup.findUnique({
            where: {
                tenant_id_name: {
                    tenant_id: tenantId,
                    name: dto.name,
                },
            },
        });

        if (existing) {
            throw new BadRequestException('An account group with this name already exists.');
        }

        return this.db.accountGroup.create({
            data: {
                tenant_id: tenantId,
                name: dto.name,
                type: dto.type,
            },
        });
    }

    async findAccountGroups(tenantId: string) {
        return this.db.accountGroup.findMany({
            where: { tenant_id: tenantId },
            include: {
                _count: {
                    select: {
                        subgroups: true,
                        accounts: true,
                    },
                },
            },
            orderBy: [{ type: 'asc' }, { name: 'asc' }],
        });
    }

    async createAccountSubgroup(tenantId: string, dto: CreateAccountSubgroupDto) {
        const group = await this.db.accountGroup.findFirst({
            where: {
                id: dto.groupId,
                tenant_id: tenantId,
            },
        });

        if (!group) {
            throw new BadRequestException('Account group not found for this tenant.');
        }

        const existing = await this.db.accountSubgroup.findUnique({
            where: {
                group_id_name: {
                    group_id: dto.groupId,
                    name: dto.name,
                },
            },
        });

        if (existing) {
            throw new BadRequestException('An account subgroup with this name already exists in the selected group.');
        }

        return this.db.accountSubgroup.create({
            data: {
                tenant_id: tenantId,
                group_id: dto.groupId,
                name: dto.name,
            },
            include: {
                group: true,
            },
        });
    }

    async findAccountSubgroups(tenantId: string, query: ListAccountSubgroupsQueryDto) {
        return this.db.accountSubgroup.findMany({
            where: {
                tenant_id: tenantId,
                ...(query.groupId ? { group_id: query.groupId } : {}),
            },
            include: {
                group: true,
                _count: {
                    select: {
                        accounts: true,
                    },
                },
            },
            orderBy: [{ group: { name: 'asc' } }, { name: 'asc' }],
        });
    }

    async createAccount(tenantId: string, dto: CreateAccountDto) {
        const group = await this.db.accountGroup.findFirst({
            where: {
                id: dto.groupId,
                tenant_id: tenantId,
            },
        });

        if (!group) {
            throw new BadRequestException('Account group not found for this tenant.');
        }

        if (group.type !== dto.type) {
            throw new BadRequestException('Account type must match the selected account group type.');
        }

        let subgroupId: string | undefined;
        if (dto.subgroupId) {
            const subgroup = await this.db.accountSubgroup.findFirst({
                where: {
                    id: dto.subgroupId,
                    tenant_id: tenantId,
                    group_id: dto.groupId,
                },
            });

            if (!subgroup) {
                throw new BadRequestException('Account subgroup not found for this tenant and group.');
            }

            subgroupId = subgroup.id;
        }

        const existing = await this.db.account.findUnique({
            where: {
                tenant_id_name: {
                    tenant_id: tenantId,
                    name: dto.name,
                },
            },
        });

        if (existing) {
            throw new BadRequestException('An account with this name already exists.');
        }

        return this.db.account.create({
            data: {
                tenant_id: tenantId,
                group_id: dto.groupId,
                subgroup_id: subgroupId,
                name: dto.name,
                code: dto.code,
                type: dto.type,
                category: dto.category,
            },
            include: {
                group: true,
                subgroup: true,
            },
        });
    }

    async findAccounts(tenantId: string, query: ListAccountsQueryDto) {
        const search = query.search?.trim();

        return this.db.account.findMany({
            where: {
                tenant_id: tenantId,
                ...(query.groupId ? { group_id: query.groupId } : {}),
                ...(query.type ? { type: query.type } : {}),
                ...(query.category ? { category: query.category } : {}),
                ...(search
                    ? {
                          OR: [
                              { name: { contains: search, mode: 'insensitive' } },
                              { code: { contains: search, mode: 'insensitive' } },
                          ],
                      }
                    : {}),
            },
            include: {
                group: true,
                subgroup: true,
            },
            orderBy: [{ type: 'asc' }, { name: 'asc' }],
        });
    }

    async getVoucherNumberPreview(tenantId: string, voucherType: VoucherType) {
        const sequence = await this.db.voucherSequence.findUnique({
            where: {
                tenant_id_voucher_type: {
                    tenant_id: tenantId,
                    voucher_type: voucherType,
                },
            },
        });

        const nextSequenceNumber = sequence?.next_number ?? 1;
        return {
            tenantId,
            voucherType,
            prefix: VOUCHER_NUMBER_PREFIXES[voucherType],
            nextSequenceNumber,
            voucherNumber: this.formatVoucherNumber(voucherType, nextSequenceNumber),
        };
    }

    async generateNextVoucherNumber(tenantId: string, voucherType: VoucherType, attempt = 1): Promise<{
        tenantId: string;
        voucherType: VoucherType;
        prefix: string;
        sequenceNumber: number;
        voucherNumber: string;
    }> {
        try {
            return await this.db.$transaction(async (tx) => {
                return this.generateNextVoucherNumberWithClient(tx, tenantId, voucherType);
            }, {
                isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            });
        } catch (error) {
            if (this.isRetryableVoucherSequenceError(error) && attempt < 3) {
                return this.generateNextVoucherNumber(tenantId, voucherType, attempt + 1);
            }

            throw error;
        }
    }

    async findVouchers(tenantId: string, query: ListVouchersQueryDto) {
        const page = Math.max(1, Number(query.page ?? 1));
        const limit = Math.min(Math.max(1, Number(query.limit ?? 20)), 100);
        this.validateDateRange(query.from, query.to);
        const where = {
            tenant_id: tenantId,
            ...(query.voucherType ? { voucher_type: query.voucherType } : {}),
            ...this.buildVoucherDateRangeFilter(query.from, query.to),
        };

        const [total, vouchers] = await Promise.all([
            this.db.voucher.count({ where }),
            this.db.voucher.findMany({
                where,
                include: {
                    details: {
                        include: {
                            account: {
                                include: {
                                    group: true,
                                    subgroup: true,
                                },
                            },
                        },
                        orderBy: { created_at: 'asc' },
                    },
                },
                orderBy: [{ date: 'desc' }, { created_at: 'desc' }],
                skip: (page - 1) * limit,
                take: limit,
            }),
        ]);

        return {
            data: vouchers.map((voucher) => this.serializeVoucher(voucher)),
            meta: {
                page,
                limit,
                total,
                totalPages: Math.max(1, Math.ceil(total / limit)),
            },
        };
    }

    async findVoucherById(tenantId: string, id: string) {
        const voucher = await this.db.voucher.findFirst({
            where: {
                tenant_id: tenantId,
                id,
            },
            include: {
                details: {
                    include: {
                        account: {
                            include: {
                                group: true,
                                subgroup: true,
                            },
                        },
                    },
                    orderBy: { created_at: 'asc' },
                },
            },
        });

        if (!voucher) {
            throw new NotFoundException('Voucher not found');
        }

        return this.serializeVoucher(voucher);
    }

    async getFinancialKpis(tenantId: string, query: FinancialKpiQueryDto) {
        const range = this.resolveDateRange(query.from, query.to);
        const {
            liquidityAccountIds,
            revenueAccountIds,
            expenseAccountIds,
            receivableAccountIds,
            payableAccountIds,
            taxLiabilityAccountIds,
        } = await this.getFinancialDashboardAccountIds(tenantId);

        const [liquidityTotals, revenueTotals, expenseTotals, receivableTotals, payableTotals, taxLiabilityTotals] = await Promise.all([
            this.aggregateVoucherDetailTotals(tenantId, liquidityAccountIds, range.fromDate, range.toDate),
            this.aggregateVoucherDetailTotals(tenantId, revenueAccountIds, range.fromDate, range.toDate),
            this.aggregateVoucherDetailTotals(tenantId, expenseAccountIds, range.fromDate, range.toDate),
            this.aggregateVoucherDetailTotals(tenantId, receivableAccountIds, range.fromDate, range.toDate),
            this.aggregateVoucherDetailTotals(tenantId, payableAccountIds, range.fromDate, range.toDate),
            this.aggregateVoucherDetailTotals(tenantId, taxLiabilityAccountIds, range.fromDate, range.toDate),
        ]);

        const cashInflow = liquidityTotals.debit;
        const cashOutflow = liquidityTotals.credit;
        const netCashMovement = this.roundAmount(cashInflow - cashOutflow);
        const grossRevenue = this.roundAmount(revenueTotals.credit - revenueTotals.debit);
        const operatingExpense = this.roundAmount(expenseTotals.debit - expenseTotals.credit);
        const accountsReceivable = receivableAccountIds.length > 0
            ? this.calculateSignedBalance(AccountType.ASSET, receivableTotals.debit, receivableTotals.credit)
            : null;
        const accountsPayable = payableAccountIds.length > 0
            ? this.calculateSignedBalance(AccountType.LIABILITY, payableTotals.debit, payableTotals.credit)
            : null;
        const taxLiability = taxLiabilityAccountIds.length > 0
            ? this.calculateSignedBalance(AccountType.LIABILITY, taxLiabilityTotals.debit, taxLiabilityTotals.credit)
            : null;

        return {
            filters: {
                from: range.from,
                to: range.to,
            },
            kpis: {
                cash_inflow: cashInflow,
                cash_outflow: cashOutflow,
                net_cash_movement: netCashMovement,
                gross_revenue: grossRevenue,
                operating_expense: operatingExpense,
                accounts_receivable: accountsReceivable,
                accounts_payable: accountsPayable,
                tax_liability: taxLiability,
            },
        };
    }

    async getFinancialTrends(tenantId: string, query: FinancialTrendQueryDto) {
        const range = this.resolveDateRange(query.from, query.to);
        const {
            liquidityAccountIds,
            revenueAccountIds,
            expenseAccountIds,
        } = await this.getFinancialDashboardAccountIds(tenantId);
        const relevantAccountIds = [...new Set([
            ...liquidityAccountIds,
            ...revenueAccountIds,
            ...expenseAccountIds,
        ])];

        const entries = relevantAccountIds.length === 0
            ? []
            : await this.db.voucherDetail.findMany({
                where: {
                    account_id: { in: relevantAccountIds },
                    voucher: {
                        tenant_id: tenantId,
                        date: {
                            gte: range.fromDate,
                            lte: range.toDate,
                        },
                    },
                },
                select: {
                    debit_amount: true,
                    credit_amount: true,
                    voucher: {
                        select: {
                            date: true,
                        },
                    },
                    account: {
                        select: {
                            id: true,
                        },
                    },
                },
                orderBy: [{ voucher: { date: 'asc' } }, { created_at: 'asc' }],
            });

        const pointByDate = new Map<string, {
            cash_inflow: number;
            cash_outflow: number;
            gross_revenue: number;
            operating_expense: number;
        }>();

        for (const entry of entries) {
            const date = this.formatDateValue(entry.voucher.date);
            const currentPoint = pointByDate.get(date) ?? {
                cash_inflow: 0,
                cash_outflow: 0,
                gross_revenue: 0,
                operating_expense: 0,
            };
            const debitAmount = Number(entry.debit_amount ?? 0);
            const creditAmount = Number(entry.credit_amount ?? 0);

            if (liquidityAccountIds.includes(entry.account.id)) {
                currentPoint.cash_inflow = this.roundAmount(currentPoint.cash_inflow + debitAmount);
                currentPoint.cash_outflow = this.roundAmount(currentPoint.cash_outflow + creditAmount);
            }

            if (revenueAccountIds.includes(entry.account.id)) {
                currentPoint.gross_revenue = this.roundAmount(currentPoint.gross_revenue + creditAmount - debitAmount);
            }

            if (expenseAccountIds.includes(entry.account.id)) {
                currentPoint.operating_expense = this.roundAmount(currentPoint.operating_expense + debitAmount - creditAmount);
            }

            pointByDate.set(date, currentPoint);
        }

        const points = this.enumerateDateRange(range.fromDate, range.toDate).map((date) => {
            const key = this.formatDateValue(date);
            const point = pointByDate.get(key) ?? {
                cash_inflow: 0,
                cash_outflow: 0,
                gross_revenue: 0,
                operating_expense: 0,
            };

            return {
                date: key,
                cash_inflow: point.cash_inflow,
                cash_outflow: point.cash_outflow,
                net_cash_movement: this.roundAmount(point.cash_inflow - point.cash_outflow),
                gross_revenue: point.gross_revenue,
                operating_expense: point.operating_expense,
                net_profit: this.roundAmount(point.gross_revenue - point.operating_expense),
            };
        });

        return {
            filters: {
                from: range.from,
                to: range.to,
            },
            granularity: 'day' as const,
            has_activity: points.some((point) => (
                point.cash_inflow !== 0
                || point.cash_outflow !== 0
                || point.gross_revenue !== 0
                || point.operating_expense !== 0
            )),
            points,
            comparison: {
                net_profit: this.roundAmount(points.reduce((sum, point) => sum + point.net_profit, 0)),
                gross_margin: null,
                gross_margin_status: 'unavailable' as const,
                gross_margin_reason: 'Sale-time cost basis is not tracked in the current data model.',
            },
        };
    }

    async findLedger(tenantId: string, accountId: string, query: ListLedgerQueryDto) {
        this.validateDateRange(query.from, query.to);

        const account = await this.db.account.findFirst({
            where: {
                tenant_id: tenantId,
                id: accountId,
            },
            include: {
                group: true,
                subgroup: true,
            },
        });

        if (!account) {
            throw new NotFoundException('Account not found');
        }

        const openingRangeStart = query.from ? this.toStartOfDay(query.from) : undefined;
        const ledgerDateRange = this.buildVoucherDateRangeFilter(query.from, query.to);

        const [openingTotals, entries] = await Promise.all([
            this.db.voucherDetail.aggregate({
                where: {
                    account_id: accountId,
                    voucher: {
                        tenant_id: tenantId,
                        ...(openingRangeStart ? { date: { lt: openingRangeStart } } : {}),
                    },
                },
                _sum: {
                    debit_amount: true,
                    credit_amount: true,
                },
            }),
            this.db.voucherDetail.findMany({
                where: {
                    account_id: accountId,
                    voucher: {
                        tenant_id: tenantId,
                        ...ledgerDateRange,
                    },
                },
                include: {
                    voucher: true,
                },
                orderBy: [{ voucher: { date: 'asc' } }, { voucher_id: 'asc' }, { created_at: 'asc' }],
            }),
        ]);

        const openingBalanceValue = this.calculateSignedBalance(
            account.type as AccountType,
            Number(openingTotals._sum.debit_amount ?? 0),
            Number(openingTotals._sum.credit_amount ?? 0),
        );

        let runningBalanceValue = openingBalanceValue;
        let totalDebit = 0;
        let totalCredit = 0;

        const data = entries.map((entry) => {
            const debitAmount = Number(entry.debit_amount ?? 0);
            const creditAmount = Number(entry.credit_amount ?? 0);

            totalDebit += debitAmount;
            totalCredit += creditAmount;
            runningBalanceValue = this.roundAmount(
                runningBalanceValue + this.calculateSignedBalance(account.type as AccountType, debitAmount, creditAmount),
            );

            const runningBalance = this.presentBalance(account.type as AccountType, runningBalanceValue);

            return {
                id: entry.id,
                voucher_id: entry.voucher_id,
                voucher_number: entry.voucher.voucher_number,
                voucher_type: entry.voucher.voucher_type,
                date: entry.voucher.date,
                description: entry.voucher.description,
                reference_number: entry.voucher.reference_number,
                narration: entry.comment ?? entry.voucher.description ?? null,
                debit_amount: debitAmount,
                credit_amount: creditAmount,
                running_balance: runningBalance.amount,
                running_balance_side: runningBalance.side,
                comment: entry.comment,
            };
        });

        const openingBalance = this.presentBalance(account.type as AccountType, openingBalanceValue);
        const closingBalance = this.presentBalance(account.type as AccountType, runningBalanceValue);

        return {
            account: {
                id: account.id,
                name: account.name,
                code: account.code,
                type: account.type,
                category: account.category,
                group: account.group,
                subgroup: account.subgroup,
            },
            filters: {
                from: query.from ?? null,
                to: query.to ?? null,
            },
            normal_balance_side: this.getNormalBalanceSide(account.type as AccountType),
            opening_balance: openingBalance.amount,
            opening_balance_side: openingBalance.side,
            closing_balance: closingBalance.amount,
            closing_balance_side: closingBalance.side,
            totals: {
                debit: this.roundAmount(totalDebit),
                credit: this.roundAmount(totalCredit),
            },
            data,
        };
    }

    async createVoucher(tenantId: string, dto: CreateVoucherDto, attempt = 1, userId?: string) {
        this.validateVoucherDetails(dto);

        try {
            const result = await this.db.$transaction(async (tx) => {
                const uniqueAccountIds = [...new Set(dto.details.map((detail) => detail.accountId))];
                const accounts = await tx.account.findMany({
                    where: {
                        tenant_id: tenantId,
                        id: { in: uniqueAccountIds },
                    },
                });

                if (accounts.length !== uniqueAccountIds.length) {
                    throw new BadRequestException('One or more accounts do not belong to the current tenant.');
                }

                this.validateVoucherTypeRules(dto, accounts);

                const generatedNumber = await this.generateNextVoucherNumberWithClient(tx, tenantId, dto.voucherType);
                const parsedDate = dto.date ? new Date(dto.date) : undefined;

                return tx.voucher.create({
                    data: {
                        tenant_id: tenantId,
                        voucher_number: generatedNumber.voucherNumber,
                        voucher_type: dto.voucherType,
                        description: dto.description,
                        reference_number: dto.referenceNumber,
                        date: parsedDate,
                        details: {
                            create: dto.details.map((detail) => ({
                                account_id: detail.accountId,
                                debit_amount: detail.debitAmount,
                                credit_amount: detail.creditAmount,
                                comment: detail.comment,
                            })),
                        },
                    },
                    include: {
                        details: {
                            include: {
                                account: {
                                    include: {
                                        group: true,
                                        subgroup: true,
                                    },
                                },
                            },
                            orderBy: { created_at: 'asc' },
                        },
                    },
                });
            }, {
                isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            });
            this.auditService.log('accounting.voucher.create', 'voucher', { tenantId, userId }, result.id, { voucher_number: (result as any).voucher_number }).catch(() => {});
            return result;
        } catch (error) {
            if (this.isRetryableVoucherSequenceError(error) && attempt < 3) {
                return this.createVoucher(tenantId, dto, attempt + 1, userId);
            }

            throw error;
        }
    }

    async updateVoucher(tenantId: string, id: string, dto: CreateVoucherDto, userId?: string) {
        this.validateVoucherDetails(dto);

        const existing = await this.db.voucher.findFirst({
            where: { tenant_id: tenantId, id },
        });

        if (!existing) {
            throw new NotFoundException('Voucher not found');
        }

        if (existing.source_module) {
            throw new BadRequestException('System-posted vouchers cannot be edited.');
        }

        const result = await this.db.$transaction(async (tx) => {
            const uniqueAccountIds = [...new Set(dto.details.map((detail) => detail.accountId))];
            const accounts = await tx.account.findMany({
                where: {
                    tenant_id: tenantId,
                    id: { in: uniqueAccountIds },
                },
            });

            if (accounts.length !== uniqueAccountIds.length) {
                throw new BadRequestException('One or more accounts do not belong to the current tenant.');
            }

            this.validateVoucherTypeRules(dto, accounts);

            await tx.voucherDetail.deleteMany({ where: { voucher_id: id } });

            return tx.voucher.update({
                where: { id },
                data: {
                    voucher_type: dto.voucherType,
                    description: dto.description,
                    reference_number: dto.referenceNumber,
                    date: dto.date ? new Date(dto.date) : undefined,
                    details: {
                        create: dto.details.map((detail) => ({
                            account_id: detail.accountId,
                            debit_amount: detail.debitAmount,
                            credit_amount: detail.creditAmount,
                            comment: detail.comment,
                        })),
                    },
                },
                include: {
                    details: {
                        include: {
                            account: {
                                include: {
                                    group: true,
                                    subgroup: true,
                                },
                            },
                        },
                        orderBy: { created_at: 'asc' },
                    },
                },
            });
        });

        this.auditService.log('accounting.voucher.update', 'voucher', { tenantId, userId }, id, { voucher_number: result.voucher_number }).catch(() => {});
        return this.serializeVoucher(result);
    }

    async deleteVoucher(tenantId: string, id: string, userId?: string) {
        const existing = await this.db.voucher.findFirst({
            where: { tenant_id: tenantId, id },
        });

        if (!existing) {
            throw new NotFoundException('Voucher not found');
        }

        if (existing.source_module) {
            throw new BadRequestException('System-posted vouchers cannot be deleted.');
        }

        await this.db.$transaction(async (tx) => {
            await tx.voucherDetail.deleteMany({ where: { voucher_id: id } });
            await tx.voucher.delete({ where: { id } });
        });

        this.auditService.log('accounting.voucher.delete', 'voucher', { tenantId, userId }, id, { voucher_number: existing.voucher_number }).catch(() => {});
        return { success: true, id };
    }

    async listPostingRules(tenantId: string, query: ListPostingRulesQueryDto) {
        const rules = await this.db.postingRule.findMany({
            where: {
                tenant_id: tenantId,
                ...(query.eventType ? { event_type: query.eventType } : {}),
                ...(query.isActive !== undefined ? { is_active: query.isActive } : {}),
            },
            include: {
                debitAccount: true,
                creditAccount: true,
            },
            orderBy: [{ event_type: 'asc' }, { priority: 'asc' }, { updated_at: 'desc' }],
        });

        return {
            data: rules.map((rule) => ({
                id: rule.id,
                eventType: rule.event_type,
                conditionKey: rule.condition_key,
                conditionValue: rule.condition_value,
                debitAccount: {
                    id: rule.debitAccount.id,
                    name: rule.debitAccount.name,
                    code: rule.debitAccount.code,
                },
                creditAccount: {
                    id: rule.creditAccount.id,
                    name: rule.creditAccount.name,
                    code: rule.creditAccount.code,
                },
                priority: rule.priority,
                isActive: rule.is_active,
                updatedAt: rule.updated_at,
            })),
        };
    }

    async updatePostingRule(tenantId: string, id: string, dto: UpdatePostingRuleDto) {
        if (dto.debitAccountId === dto.creditAccountId) {
            throw new BadRequestException('Debit and credit accounts must be different.');
        }

        const existingRule = await this.db.postingRule.findFirst({
            where: {
                id,
                tenant_id: tenantId,
            },
        });

        if (!existingRule) {
            throw new NotFoundException('Posting rule not found.');
        }

        const accounts = await this.db.account.findMany({
            where: {
                tenant_id: tenantId,
                id: { in: [dto.debitAccountId, dto.creditAccountId] },
            },
            select: { id: true },
        });

        if (accounts.length !== 2) {
            throw new BadRequestException('One or more mapped accounts do not belong to this tenant.');
        }

        if (dto.conditionKey === 'none' && dto.conditionValue) {
            throw new BadRequestException('Condition value must be empty when condition key is none.');
        }

        if (dto.conditionKey !== 'none' && !dto.conditionValue) {
            throw new BadRequestException('Condition value is required when condition key is not none.');
        }

        const updated = await this.db.postingRule.update({
            where: { id },
            data: {
                debit_account_id: dto.debitAccountId,
                credit_account_id: dto.creditAccountId,
                condition_key: dto.conditionKey,
                condition_value: dto.conditionKey === 'none' ? null : dto.conditionValue,
                priority: dto.priority,
                is_active: dto.isActive,
            },
            include: {
                debitAccount: true,
                creditAccount: true,
            },
        });

        this.auditService.log('accounting.posting_rule.update', 'posting_rule', { tenantId }, updated.id, {}).catch(() => {});

        return {
            id: updated.id,
            eventType: updated.event_type,
            conditionKey: updated.condition_key,
            conditionValue: updated.condition_value,
            debitAccountId: updated.debit_account_id,
            creditAccountId: updated.credit_account_id,
            priority: updated.priority,
            isActive: updated.is_active,
            updatedAt: updated.updated_at,
        };
    }

    async listPostingExceptions(tenantId: string, query: ListPostingExceptionsQueryDto) {
        this.validateDateRange(query.from, query.to);
        const page = Math.max(1, Number(query.page ?? 1));
        const limit = Math.min(Math.max(1, Number(query.limit ?? 20)), 100);

        const where = {
            tenant_id: tenantId,
            ...(query.status ? { status: query.status } : {}),
            ...(query.module ? { source_module: query.module } : {}),
            ...(() => {
                if (!query.from && !query.to) {
                    return {};
                }
                return {
                    updated_at: {
                        ...(query.from ? { gte: this.toStartOfDay(query.from) } : {}),
                        ...(query.to ? { lte: this.toEndOfDay(query.to) } : {}),
                    },
                };
            })(),
        };

        const [total, events] = await Promise.all([
            this.db.postingEvent.count({ where }),
            this.db.postingEvent.findMany({
                where,
                include: {
                    voucher: {
                        select: {
                            id: true,
                            voucher_number: true,
                            voucher_type: true,
                        },
                    },
                },
                orderBy: [{ updated_at: 'desc' }],
                skip: (page - 1) * limit,
                take: limit,
            }),
        ]);

        return {
            data: events.map((event) => ({
                id: event.id,
                eventType: event.event_type,
                sourceModule: event.source_module,
                sourceType: event.source_type,
                sourceId: event.source_id,
                status: event.status,
                attemptCount: event.attempt_count,
                lastError: event.last_error,
                lastAttemptAt: event.last_attempt_at,
                voucher: event.voucher,
            })),
            pagination: {
                page,
                limit,
                total,
            },
        };
    }

    async retryPostingException(tenantId: string, id: string) {
        const event = await this.db.postingEvent.findFirst({
            where: {
                id,
                tenant_id: tenantId,
            },
        });

        if (!event) {
            throw new NotFoundException('POSTING_EXCEPTION_NOT_FOUND');
        }

        if (event.status === 'posted') {
            throw new BadRequestException('POSTING_RETRY_ALREADY_POSTED');
        }

        await this.db.postingEvent.update({
            where: { id },
            data: {
                status: 'pending',
                attempt_count: { increment: 1 },
                last_attempt_at: new Date(),
                last_error: null,
            },
        });

        return {
            id,
            status: 'pending',
            message: 'Retry queued. Re-trigger source workflow to re-run posting.',
        };
    }

    async getProfitLoss(tenantId: string, query: ProfitLossQueryDto) {
        const range = this.resolveDateRange(query.from, query.to);

        const accounts = await this.db.account.findMany({
            where: {
                tenant_id: tenantId,
                type: { in: [AccountType.REVENUE, AccountType.EXPENSE] },
            },
            include: { group: true, subgroup: true },
        });

        if (accounts.length === 0) {
            return {
                filters: { from: range.from, to: range.to },
                revenue: { groups: [], total: 0 },
                expenses: { groups: [], total: 0 },
                net_profit: 0,
            };
        }

        const details = await this.db.voucherDetail.findMany({
            where: {
                account_id: { in: accounts.map((a) => a.id) },
                voucher: {
                    tenant_id: tenantId,
                    date: { gte: range.fromDate, lte: range.toDate },
                },
            },
            select: { account_id: true, debit_amount: true, credit_amount: true },
        });

        const accountTotals = new Map<string, { debit: number; credit: number }>();
        for (const detail of details) {
            const existing = accountTotals.get(detail.account_id) ?? { debit: 0, credit: 0 };
            existing.debit += Number(detail.debit_amount ?? 0);
            existing.credit += Number(detail.credit_amount ?? 0);
            accountTotals.set(detail.account_id, existing);
        }

        const buildPLGroups = (accts: typeof accounts, type: AccountType) => {
            const groupMap = new Map<string, { group: any; accounts: any[]; total: number }>();
            for (const account of accts) {
                const totals = accountTotals.get(account.id) ?? { debit: 0, credit: 0 };
                const balance = type === AccountType.REVENUE
                    ? this.roundAmount(totals.credit - totals.debit)
                    : this.roundAmount(totals.debit - totals.credit);
                const gid = account.group_id;
                const existing = groupMap.get(gid) ?? {
                    group: { id: account.group.id, name: account.group.name },
                    accounts: [],
                    total: 0,
                };
                existing.accounts.push({
                    id: account.id,
                    name: account.name,
                    code: account.code,
                    subgroup: account.subgroup ? { id: account.subgroup.id, name: account.subgroup.name } : null,
                    balance,
                });
                existing.total = this.roundAmount(existing.total + balance);
                groupMap.set(gid, existing);
            }
            return Array.from(groupMap.values()).sort((a, b) => a.group.name.localeCompare(b.group.name));
        };

        const revenueGroups = buildPLGroups(
            accounts.filter((a) => a.type === AccountType.REVENUE),
            AccountType.REVENUE,
        );
        const expenseGroups = buildPLGroups(
            accounts.filter((a) => a.type === AccountType.EXPENSE),
            AccountType.EXPENSE,
        );

        const totalRevenue = this.roundAmount(revenueGroups.reduce((sum, g) => sum + g.total, 0));
        const totalExpenses = this.roundAmount(expenseGroups.reduce((sum, g) => sum + g.total, 0));

        return {
            filters: { from: range.from, to: range.to },
            revenue: { groups: revenueGroups, total: totalRevenue },
            expenses: { groups: expenseGroups, total: totalExpenses },
            net_profit: this.roundAmount(totalRevenue - totalExpenses),
        };
    }

    async getBalanceSheet(tenantId: string, query: BalanceSheetQueryDto) {
        const asOfDateStr = query.asOfDate ?? this.formatDateValue(new Date());
        const asOfDate = this.toEndOfDay(asOfDateStr);

        const bsAccounts = await this.db.account.findMany({
            where: {
                tenant_id: tenantId,
                type: { in: [AccountType.ASSET, AccountType.LIABILITY, AccountType.EQUITY] },
            },
            include: { group: true, subgroup: true },
        });

        const plAccountIds = await this.db.account.findMany({
            where: { tenant_id: tenantId, type: { in: [AccountType.REVENUE, AccountType.EXPENSE] } },
            select: { id: true, type: true },
        });

        const allIds = [...bsAccounts.map((a) => a.id), ...plAccountIds.map((a) => a.id)];

        const details = allIds.length > 0
            ? await this.db.voucherDetail.findMany({
                where: {
                    account_id: { in: allIds },
                    voucher: { tenant_id: tenantId, date: { lte: asOfDate } },
                },
                select: { account_id: true, debit_amount: true, credit_amount: true },
              })
            : [];

        const accountTotals = new Map<string, { debit: number; credit: number }>();
        for (const detail of details) {
            const existing = accountTotals.get(detail.account_id) ?? { debit: 0, credit: 0 };
            existing.debit += Number(detail.debit_amount ?? 0);
            existing.credit += Number(detail.credit_amount ?? 0);
            accountTotals.set(detail.account_id, existing);
        }

        let plRevenue = 0;
        let plExpenses = 0;
        for (const plAccount of plAccountIds) {
            const totals = accountTotals.get(plAccount.id) ?? { debit: 0, credit: 0 };
            if (plAccount.type === AccountType.REVENUE) {
                plRevenue += totals.credit - totals.debit;
            } else {
                plExpenses += totals.debit - totals.credit;
            }
        }
        const netProfit = this.roundAmount(plRevenue - plExpenses);

        const buildBSGroups = (accts: typeof bsAccounts, type: AccountType) => {
            const groupMap = new Map<string, { group: any; accounts: any[]; total: number }>();
            for (const account of accts) {
                const totals = accountTotals.get(account.id) ?? { debit: 0, credit: 0 };
                const balance = this.calculateSignedBalance(type, totals.debit, totals.credit);
                const gid = account.group_id;
                const existing = groupMap.get(gid) ?? {
                    group: { id: account.group.id, name: account.group.name },
                    accounts: [],
                    total: 0,
                };
                existing.accounts.push({
                    id: account.id,
                    name: account.name,
                    code: account.code,
                    subgroup: account.subgroup ? { id: account.subgroup.id, name: account.subgroup.name } : null,
                    balance: this.roundAmount(balance),
                });
                existing.total = this.roundAmount(existing.total + balance);
                groupMap.set(gid, existing);
            }
            return Array.from(groupMap.values()).sort((a, b) => a.group.name.localeCompare(b.group.name));
        };

        const assetGroups = buildBSGroups(bsAccounts.filter((a) => a.type === AccountType.ASSET), AccountType.ASSET);
        const liabilityGroups = buildBSGroups(bsAccounts.filter((a) => a.type === AccountType.LIABILITY), AccountType.LIABILITY);
        const equityGroups = buildBSGroups(bsAccounts.filter((a) => a.type === AccountType.EQUITY), AccountType.EQUITY);

        const totalAssets = this.roundAmount(assetGroups.reduce((sum, g) => sum + g.total, 0));
        const totalLiabilities = this.roundAmount(liabilityGroups.reduce((sum, g) => sum + g.total, 0));
        const totalEquity = this.roundAmount(equityGroups.reduce((sum, g) => sum + g.total, 0) + netProfit);
        const totalLiabilitiesAndEquity = this.roundAmount(totalLiabilities + totalEquity);

        return {
            as_of: asOfDateStr,
            assets: { groups: assetGroups, total: totalAssets },
            liabilities: { groups: liabilityGroups, total: totalLiabilities },
            equity: { groups: equityGroups, net_profit: netProfit, total: totalEquity },
            total_liabilities_and_equity: totalLiabilitiesAndEquity,
            is_balanced: Math.abs(totalAssets - totalLiabilitiesAndEquity) < 0.01,
        };
    }

    async getTrialBalance(tenantId: string, query: TrialBalanceQueryDto) {
        const asOfDateStr = query.asOfDate ?? this.formatDateValue(new Date());
        const asOfDate = this.toEndOfDay(asOfDateStr);

        const accounts = await this.db.account.findMany({
            where: { tenant_id: tenantId },
            include: { group: true, subgroup: true },
        });

        if (accounts.length === 0) {
            return {
                as_of: asOfDateStr,
                rows: [],
                totals: { debit: 0, credit: 0 },
                is_balanced: true,
            };
        }

        const details = await this.db.voucherDetail.findMany({
            where: {
                account_id: { in: accounts.map((a) => a.id) },
                voucher: { tenant_id: tenantId, date: { lte: asOfDate } },
            },
            select: { account_id: true, debit_amount: true, credit_amount: true },
        });

        const accountTotals = new Map<string, { debit: number; credit: number }>();
        for (const detail of details) {
            const existing = accountTotals.get(detail.account_id) ?? { debit: 0, credit: 0 };
            existing.debit += Number(detail.debit_amount ?? 0);
            existing.credit += Number(detail.credit_amount ?? 0);
            accountTotals.set(detail.account_id, existing);
        }

        let grandDebitBalance = 0;
        let grandCreditBalance = 0;

        const rows = accounts.map((account) => {
            const totals = accountTotals.get(account.id) ?? { debit: 0, credit: 0 };
            const signedBalance = this.calculateSignedBalance(account.type as AccountType, totals.debit, totals.credit);
            const presented = this.presentBalance(account.type as AccountType, signedBalance);

            const debitBalance = presented.side === 'debit' ? presented.amount : 0;
            const creditBalance = presented.side === 'credit' ? presented.amount : 0;

            grandDebitBalance = this.roundAmount(grandDebitBalance + debitBalance);
            grandCreditBalance = this.roundAmount(grandCreditBalance + creditBalance);

            return {
                account: {
                    id: account.id,
                    name: account.name,
                    code: account.code,
                    type: account.type,
                    group: { id: account.group.id, name: account.group.name },
                    subgroup: account.subgroup ? { id: account.subgroup.id, name: account.subgroup.name } : null,
                },
                debit_total: this.roundAmount(totals.debit),
                credit_total: this.roundAmount(totals.credit),
                closing_balance: presented.amount,
                closing_balance_side: presented.side,
                debit_balance: debitBalance,
                credit_balance: creditBalance,
            };
        });

        return {
            as_of: asOfDateStr,
            rows,
            totals: { debit: grandDebitBalance, credit: grandCreditBalance },
            is_balanced: Math.abs(grandDebitBalance - grandCreditBalance) < 0.01,
        };
    }

    async getArAging(tenantId: string, query: ArAgingQueryDto) {
        const asOfDateStr = query.asOfDate ?? this.formatDateValue(new Date());
        const asOfDate = this.toEndOfDay(asOfDateStr);
        const asOfMs = asOfDate.getTime();

        const allAccounts = await this.db.account.findMany({
            where: { tenant_id: tenantId, type: AccountType.ASSET },
            select: { id: true, name: true, code: true, type: true },
        });

        const arAccounts = allAccounts.filter((a) => this.matchesAccountPattern(a, RECEIVABLE_ACCOUNT_PATTERN));

        if (arAccounts.length === 0) {
            return {
                as_of: asOfDateStr,
                accounts: [],
                totals: { balance: 0, current: 0, overdue_31_60: 0, overdue_61_90: 0, overdue_90_plus: 0 },
                note: 'Aging is based on voucher date; individual invoice due dates are not tracked.',
            };
        }

        const entries = await this.db.voucherDetail.findMany({
            where: {
                account_id: { in: arAccounts.map((a) => a.id) },
                voucher: { tenant_id: tenantId, date: { lte: asOfDate } },
            },
            select: {
                account_id: true,
                debit_amount: true,
                credit_amount: true,
                voucher: { select: { date: true } },
            },
        });

        const dayMs = 24 * 60 * 60 * 1000;

        const totals = { balance: 0, current: 0, overdue_31_60: 0, overdue_61_90: 0, overdue_90_plus: 0 };
        const accountResults = arAccounts.map((account) => {
            const accountEntries = entries.filter((e) => e.account_id === account.id);
            let totalDebit = 0;
            let totalCredit = 0;
            const buckets = { current: 0, overdue_31_60: 0, overdue_61_90: 0, overdue_90_plus: 0 };

            for (const entry of accountEntries) {
                const debit = Number(entry.debit_amount ?? 0);
                const credit = Number(entry.credit_amount ?? 0);
                totalDebit += debit;
                totalCredit += credit;

                if (debit > 0) {
                    const ageDays = Math.floor((asOfMs - entry.voucher.date.getTime()) / dayMs);
                    if (ageDays <= 30) buckets.current = this.roundAmount(buckets.current + debit);
                    else if (ageDays <= 60) buckets.overdue_31_60 = this.roundAmount(buckets.overdue_31_60 + debit);
                    else if (ageDays <= 90) buckets.overdue_61_90 = this.roundAmount(buckets.overdue_61_90 + debit);
                    else buckets.overdue_90_plus = this.roundAmount(buckets.overdue_90_plus + debit);
                }
            }

            const signedBalance = this.calculateSignedBalance(AccountType.ASSET, totalDebit, totalCredit);
            const presented = this.presentBalance(AccountType.ASSET, signedBalance);

            totals.balance = this.roundAmount(totals.balance + presented.amount);
            totals.current = this.roundAmount(totals.current + buckets.current);
            totals.overdue_31_60 = this.roundAmount(totals.overdue_31_60 + buckets.overdue_31_60);
            totals.overdue_61_90 = this.roundAmount(totals.overdue_61_90 + buckets.overdue_61_90);
            totals.overdue_90_plus = this.roundAmount(totals.overdue_90_plus + buckets.overdue_90_plus);

            return {
                id: account.id,
                name: account.name,
                code: account.code,
                type: account.type,
                balance: presented.amount,
                balance_side: presented.side,
                buckets,
            };
        });

        return {
            as_of: asOfDateStr,
            accounts: accountResults,
            totals,
            note: 'Aging is based on voucher date; individual invoice due dates are not tracked.',
        };
    }

    async getApAging(tenantId: string, query: ApAgingQueryDto) {
        const asOfDateStr = query.asOfDate ?? this.formatDateValue(new Date());
        const asOfDate = this.toEndOfDay(asOfDateStr);
        const asOfMs = asOfDate.getTime();

        const allAccounts = await this.db.account.findMany({
            where: { tenant_id: tenantId, type: AccountType.LIABILITY },
            select: { id: true, name: true, code: true, type: true },
        });

        const apAccounts = allAccounts.filter((a) => this.matchesAccountPattern(a, PAYABLE_ACCOUNT_PATTERN));

        if (apAccounts.length === 0) {
            return {
                as_of: asOfDateStr,
                accounts: [],
                totals: { balance: 0, current: 0, overdue_31_60: 0, overdue_61_90: 0, overdue_90_plus: 0 },
                note: 'Aging is based on voucher date; individual invoice due dates are not tracked.',
            };
        }

        const entries = await this.db.voucherDetail.findMany({
            where: {
                account_id: { in: apAccounts.map((a) => a.id) },
                voucher: { tenant_id: tenantId, date: { lte: asOfDate } },
            },
            select: {
                account_id: true,
                debit_amount: true,
                credit_amount: true,
                voucher: { select: { date: true } },
            },
        });

        const dayMs = 24 * 60 * 60 * 1000;
        const totals = { balance: 0, current: 0, overdue_31_60: 0, overdue_61_90: 0, overdue_90_plus: 0 };

        const accountResults = apAccounts.map((account) => {
            const accountEntries = entries.filter((e) => e.account_id === account.id);
            let totalDebit = 0;
            let totalCredit = 0;
            const buckets = { current: 0, overdue_31_60: 0, overdue_61_90: 0, overdue_90_plus: 0 };

            for (const entry of accountEntries) {
                const debit = Number(entry.debit_amount ?? 0);
                const credit = Number(entry.credit_amount ?? 0);
                totalDebit += debit;
                totalCredit += credit;

                if (credit > 0) {
                    const ageDays = Math.floor((asOfMs - entry.voucher.date.getTime()) / dayMs);
                    if (ageDays <= 30) buckets.current = this.roundAmount(buckets.current + credit);
                    else if (ageDays <= 60) buckets.overdue_31_60 = this.roundAmount(buckets.overdue_31_60 + credit);
                    else if (ageDays <= 90) buckets.overdue_61_90 = this.roundAmount(buckets.overdue_61_90 + credit);
                    else buckets.overdue_90_plus = this.roundAmount(buckets.overdue_90_plus + credit);
                }
            }

            const signedBalance = this.calculateSignedBalance(AccountType.LIABILITY, totalDebit, totalCredit);
            const presented = this.presentBalance(AccountType.LIABILITY, signedBalance);

            totals.balance = this.roundAmount(totals.balance + presented.amount);
            totals.current = this.roundAmount(totals.current + buckets.current);
            totals.overdue_31_60 = this.roundAmount(totals.overdue_31_60 + buckets.overdue_31_60);
            totals.overdue_61_90 = this.roundAmount(totals.overdue_61_90 + buckets.overdue_61_90);
            totals.overdue_90_plus = this.roundAmount(totals.overdue_90_plus + buckets.overdue_90_plus);

            return {
                id: account.id,
                name: account.name,
                code: account.code,
                type: account.type,
                balance: presented.amount,
                balance_side: presented.side,
                buckets,
            };
        });

        return {
            as_of: asOfDateStr,
            accounts: accountResults,
            totals,
            note: 'Aging is based on voucher date; individual invoice due dates are not tracked.',
        };
    }

    async getComparativePL(tenantId: string, query: ComparativePLQueryDto) {
        const range = this.resolveDateRange(query.from, query.to);
        const fromDate = range.fromDate;
        const toDate = range.toDate;

        // Calculate period length in days
        const periodMs = toDate.getTime() - fromDate.getTime();

        // Previous period: shift back by periodMs + 1 day
        const prevToDate = new Date(fromDate.getTime() - 1);
        const prevFromDate = new Date(prevToDate.getTime() - periodMs);

        // Year-ago period: same dates but 12 months earlier
        const yearAgoFromDate = new Date(fromDate);
        yearAgoFromDate.setUTCFullYear(yearAgoFromDate.getUTCFullYear() - 1);
        const yearAgoToDate = new Date(toDate);
        yearAgoToDate.setUTCFullYear(yearAgoToDate.getUTCFullYear() - 1);

        const accounts = await this.db.account.findMany({
            where: { tenant_id: tenantId, type: { in: [AccountType.REVENUE, AccountType.EXPENSE] } },
            include: { group: true },
        });

        if (accounts.length === 0) {
            return {
                periods: {
                    current: { from: range.from, to: range.to },
                    previous: { from: this.formatDateValue(prevFromDate), to: this.formatDateValue(prevToDate) },
                    year_ago: { from: this.formatDateValue(yearAgoFromDate), to: this.formatDateValue(yearAgoToDate) },
                },
                revenue: { groups: [], total: { current: 0, previous: 0, year_ago: 0 } },
                expenses: { groups: [], total: { current: 0, previous: 0, year_ago: 0 } },
                net_profit: { current: 0, previous: 0, year_ago: 0 },
            };
        }

        const allIds = accounts.map((a) => a.id);

        const [currentDetails, prevDetails, yearAgoDetails] = await Promise.all([
            this.db.voucherDetail.findMany({
                where: { account_id: { in: allIds }, voucher: { tenant_id: tenantId, date: { gte: fromDate, lte: toDate } } },
                select: { account_id: true, debit_amount: true, credit_amount: true },
            }),
            this.db.voucherDetail.findMany({
                where: { account_id: { in: allIds }, voucher: { tenant_id: tenantId, date: { gte: prevFromDate, lte: prevToDate } } },
                select: { account_id: true, debit_amount: true, credit_amount: true },
            }),
            this.db.voucherDetail.findMany({
                where: { account_id: { in: allIds }, voucher: { tenant_id: tenantId, date: { gte: yearAgoFromDate, lte: yearAgoToDate } } },
                select: { account_id: true, debit_amount: true, credit_amount: true },
            }),
        ]);

        const buildTotalsMap = (details: Array<{ account_id: string; debit_amount: any; credit_amount: any }>) => {
            const map = new Map<string, { debit: number; credit: number }>();
            for (const d of details) {
                const existing = map.get(d.account_id) ?? { debit: 0, credit: 0 };
                existing.debit += Number(d.debit_amount ?? 0);
                existing.credit += Number(d.credit_amount ?? 0);
                map.set(d.account_id, existing);
            }
            return map;
        };

        const currentMap = buildTotalsMap(currentDetails);
        const prevMap = buildTotalsMap(prevDetails);
        const yearAgoMap = buildTotalsMap(yearAgoDetails);

        const calcBalance = (map: Map<string, { debit: number; credit: number }>, accountId: string, type: AccountType) => {
            const t = map.get(accountId) ?? { debit: 0, credit: 0 };
            return type === AccountType.REVENUE
                ? this.roundAmount(t.credit - t.debit)
                : this.roundAmount(t.debit - t.credit);
        };

        const buildGroups = (accts: typeof accounts, type: AccountType) => {
            const groupMap = new Map<string, {
                group: { id: string; name: string };
                accounts: any[];
                current: number;
                previous: number;
                year_ago: number;
            }>();

            for (const account of accts) {
                const cur = calcBalance(currentMap, account.id, type);
                const prev = calcBalance(prevMap, account.id, type);
                const ya = calcBalance(yearAgoMap, account.id, type);
                const variancePeriod = this.roundAmount(cur - prev);
                const variancePeriodPct = prev !== 0 ? this.roundAmount((variancePeriod / Math.abs(prev)) * 100) : null;

                const gid = account.group_id;
                const existing = groupMap.get(gid) ?? {
                    group: { id: account.group.id, name: account.group.name },
                    accounts: [],
                    current: 0,
                    previous: 0,
                    year_ago: 0,
                };
                existing.accounts.push({ id: account.id, name: account.name, code: account.code, current: cur, previous: prev, year_ago: ya, variance_period: variancePeriod, variance_period_pct: variancePeriodPct });
                existing.current = this.roundAmount(existing.current + cur);
                existing.previous = this.roundAmount(existing.previous + prev);
                existing.year_ago = this.roundAmount(existing.year_ago + ya);
                groupMap.set(gid, existing);
            }

            return Array.from(groupMap.values()).sort((a, b) => a.group.name.localeCompare(b.group.name));
        };

        const revenueGroups = buildGroups(accounts.filter((a) => a.type === AccountType.REVENUE), AccountType.REVENUE);
        const expenseGroups = buildGroups(accounts.filter((a) => a.type === AccountType.EXPENSE), AccountType.EXPENSE);

        const revenueTotal = {
            current: this.roundAmount(revenueGroups.reduce((s, g) => s + g.current, 0)),
            previous: this.roundAmount(revenueGroups.reduce((s, g) => s + g.previous, 0)),
            year_ago: this.roundAmount(revenueGroups.reduce((s, g) => s + g.year_ago, 0)),
        };
        const expensesTotal = {
            current: this.roundAmount(expenseGroups.reduce((s, g) => s + g.current, 0)),
            previous: this.roundAmount(expenseGroups.reduce((s, g) => s + g.previous, 0)),
            year_ago: this.roundAmount(expenseGroups.reduce((s, g) => s + g.year_ago, 0)),
        };

        return {
            periods: {
                current: { from: range.from, to: range.to },
                previous: { from: this.formatDateValue(prevFromDate), to: this.formatDateValue(prevToDate) },
                year_ago: { from: this.formatDateValue(yearAgoFromDate), to: this.formatDateValue(yearAgoToDate) },
            },
            revenue: { groups: revenueGroups, total: revenueTotal },
            expenses: { groups: expenseGroups, total: expensesTotal },
            net_profit: {
                current: this.roundAmount(revenueTotal.current - expensesTotal.current),
                previous: this.roundAmount(revenueTotal.previous - expensesTotal.previous),
                year_ago: this.roundAmount(revenueTotal.year_ago - expensesTotal.year_ago),
            },
        };
    }

    async getVatTaxReport(tenantId: string, query: VatTaxReportQueryDto) {
        const range = this.resolveDateRange(query.from, query.to);

        const accounts = await this.db.account.findMany({
            where: {
                tenant_id: tenantId,
                type: { in: [AccountType.LIABILITY, AccountType.ASSET] },
            },
            select: { id: true, name: true, code: true, type: true },
        });

        const outputVatAccounts = accounts.filter(
            (a) => a.type === AccountType.LIABILITY && this.matchesAccountPattern(a, TAX_LIABILITY_ACCOUNT_PATTERN),
        );
        const inputVatAccounts = accounts.filter(
            (a) => a.type === AccountType.ASSET && this.matchesAccountPattern(a, TAX_LIABILITY_ACCOUNT_PATTERN),
        );

        const allVatIds = [...outputVatAccounts.map((a) => a.id), ...inputVatAccounts.map((a) => a.id)];

        const details = allVatIds.length === 0 ? [] : await this.db.voucherDetail.findMany({
            where: {
                account_id: { in: allVatIds },
                voucher: { tenant_id: tenantId, date: { gte: range.fromDate, lte: range.toDate } },
            },
            select: { account_id: true, debit_amount: true, credit_amount: true },
        });

        const totalsMap = new Map<string, { debit: number; credit: number }>();
        for (const d of details) {
            const existing = totalsMap.get(d.account_id) ?? { debit: 0, credit: 0 };
            existing.debit += Number(d.debit_amount ?? 0);
            existing.credit += Number(d.credit_amount ?? 0);
            totalsMap.set(d.account_id, existing);
        }

        const outputRows = outputVatAccounts.map((a) => {
            const t = totalsMap.get(a.id) ?? { debit: 0, credit: 0 };
            return { id: a.id, name: a.name, code: a.code, type: a.type, total: this.roundAmount(t.credit - t.debit) };
        });
        const inputRows = inputVatAccounts.map((a) => {
            const t = totalsMap.get(a.id) ?? { debit: 0, credit: 0 };
            return { id: a.id, name: a.name, code: a.code, type: a.type, total: this.roundAmount(t.debit - t.credit) };
        });

        const outputTotal = this.roundAmount(outputRows.reduce((s, r) => s + r.total, 0));
        const inputTotal = this.roundAmount(inputRows.reduce((s, r) => s + r.total, 0));

        return {
            filters: { from: range.from, to: range.to },
            output_vat: { accounts: outputRows, total: outputTotal },
            input_vat: { accounts: inputRows, total: inputTotal },
            net_vat_payable: this.roundAmount(outputTotal - inputTotal),
            note: 'Output VAT collected from customers minus Input VAT paid on purchases.',
        };
    }

    async getFinancialRatios(tenantId: string, query: FinancialRatiosQueryDto) {
        const asOfDateStr = query.asOfDate ?? this.formatDateValue(new Date());
        const asOfDate = this.toEndOfDay(asOfDateStr);
        const range = this.resolveDateRange(query.from, query.to);

        const accounts = await this.db.account.findMany({
            where: { tenant_id: tenantId },
            select: { id: true, name: true, code: true, type: true, category: true },
        });

        const allIds = accounts.map((a) => a.id);

        const [bsDetails, plDetails] = await Promise.all([
            allIds.length === 0 ? Promise.resolve([]) : this.db.voucherDetail.findMany({
                where: {
                    account_id: { in: allIds },
                    voucher: { tenant_id: tenantId, date: { lte: asOfDate } },
                },
                select: { account_id: true, debit_amount: true, credit_amount: true },
            }),
            allIds.length === 0 ? Promise.resolve([]) : this.db.voucherDetail.findMany({
                where: {
                    account_id: { in: allIds },
                    voucher: { tenant_id: tenantId, date: { gte: range.fromDate, lte: range.toDate } },
                },
                select: { account_id: true, debit_amount: true, credit_amount: true },
            }),
        ]);

        const bsMap = new Map<string, { debit: number; credit: number }>();
        for (const d of bsDetails) {
            const e = bsMap.get(d.account_id) ?? { debit: 0, credit: 0 };
            e.debit += Number(d.debit_amount ?? 0);
            e.credit += Number(d.credit_amount ?? 0);
            bsMap.set(d.account_id, e);
        }

        const plMap = new Map<string, { debit: number; credit: number }>();
        for (const d of plDetails) {
            const e = plMap.get(d.account_id) ?? { debit: 0, credit: 0 };
            e.debit += Number(d.debit_amount ?? 0);
            e.credit += Number(d.credit_amount ?? 0);
            plMap.set(d.account_id, e);
        }

        const assetAccounts = accounts.filter((a) => a.type === AccountType.ASSET);
        const liabilityAccounts = accounts.filter((a) => a.type === AccountType.LIABILITY);
        const revenueAccounts = accounts.filter((a) => a.type === AccountType.REVENUE);
        const expenseAccounts = accounts.filter((a) => a.type === AccountType.EXPENSE);

        const totalAssets = assetAccounts.reduce((s, a) => {
            const t = bsMap.get(a.id) ?? { debit: 0, credit: 0 };
            return s + this.calculateSignedBalance(AccountType.ASSET, t.debit, t.credit);
        }, 0);

        const totalLiabilities = liabilityAccounts.reduce((s, a) => {
            const t = bsMap.get(a.id) ?? { debit: 0, credit: 0 };
            return s + this.calculateSignedBalance(AccountType.LIABILITY, t.debit, t.credit);
        }, 0);

        const revenue = revenueAccounts.reduce((s, a) => {
            const t = plMap.get(a.id) ?? { debit: 0, credit: 0 };
            return s + this.roundAmount(t.credit - t.debit);
        }, 0);

        const totalExpenses = expenseAccounts.reduce((s, a) => {
            const t = plMap.get(a.id) ?? { debit: 0, credit: 0 };
            return s + this.roundAmount(t.debit - t.credit);
        }, 0);

        const netProfit = this.roundAmount(revenue - totalExpenses);

        const arAccounts = assetAccounts.filter((a) => this.matchesAccountPattern(a, RECEIVABLE_ACCOUNT_PATTERN));
        const apAccounts = liabilityAccounts.filter((a) => this.matchesAccountPattern(a, PAYABLE_ACCOUNT_PATTERN));

        const arBalance = arAccounts.reduce((s, a) => {
            const t = bsMap.get(a.id) ?? { debit: 0, credit: 0 };
            return s + this.calculateSignedBalance(AccountType.ASSET, t.debit, t.credit);
        }, 0);

        const apBalance = apAccounts.reduce((s, a) => {
            const t = bsMap.get(a.id) ?? { debit: 0, credit: 0 };
            return s + this.calculateSignedBalance(AccountType.LIABILITY, t.debit, t.credit);
        }, 0);

        const currentRatio = totalLiabilities !== 0 ? this.roundAmount(totalAssets / totalLiabilities) : null;
        const grossMarginPct = revenue !== 0 ? this.roundAmount((netProfit / revenue) * 100) : null;
        const netProfitMarginPct = revenue !== 0 ? this.roundAmount((netProfit / revenue) * 100) : null;
        const dsoDays = revenue !== 0 ? this.roundAmount((arBalance / revenue) * 30) : null;
        const dpoDays = totalExpenses !== 0 ? this.roundAmount((apBalance / totalExpenses) * 30) : null;

        return {
            as_of: asOfDateStr,
            period: { from: range.from, to: range.to },
            ratios: {
                current_ratio: currentRatio,
                gross_margin_pct: grossMarginPct,
                net_profit_margin_pct: netProfitMarginPct,
                dso_days: dsoDays,
                dpo_days: dpoDays,
                revenue: this.roundAmount(revenue),
                total_expenses: this.roundAmount(totalExpenses),
                net_profit: netProfit,
                total_assets: this.roundAmount(totalAssets),
                total_liabilities: this.roundAmount(totalLiabilities),
            },
        };
    }

    async getCashFlow(tenantId: string, query: CashFlowQueryDto) {
        const range = this.resolveDateRange(query.from, query.to);

        const INVESTING_PATTERN = /(fixed\s+asset|property|equipment|plant|machinery|vehicle|furniture|land|building)/i;
        const FINANCING_PATTERN = /(loan|borrowing|debt|mortgage|bond)/i;

        const accounts = await this.db.account.findMany({
            where: { tenant_id: tenantId },
            select: { id: true, name: true, code: true, type: true, category: true },
        });

        // Classify accounts
        const investingAccounts = accounts.filter(
            (a) => a.type === AccountType.ASSET && this.matchesAccountPattern(a, INVESTING_PATTERN),
        );
        const financingAccounts = accounts.filter(
            (a) => a.type === AccountType.EQUITY ||
                (a.type === AccountType.LIABILITY && this.matchesAccountPattern(a, FINANCING_PATTERN)),
        );
        const investingIds = new Set(investingAccounts.map((a) => a.id));
        const financingIds = new Set(financingAccounts.map((a) => a.id));
        const operatingAccounts = accounts.filter((a) => !investingIds.has(a.id) && !financingIds.has(a.id));

        const allIds = accounts.map((a) => a.id);

        // Opening balances (before period)
        const openingDetails = allIds.length === 0 ? [] : await this.db.voucherDetail.findMany({
            where: {
                account_id: { in: allIds },
                voucher: { tenant_id: tenantId, date: { lt: range.fromDate } },
            },
            select: { account_id: true, debit_amount: true, credit_amount: true },
        });

        // Period details
        const periodDetails = allIds.length === 0 ? [] : await this.db.voucherDetail.findMany({
            where: {
                account_id: { in: allIds },
                voucher: { tenant_id: tenantId, date: { gte: range.fromDate, lte: range.toDate } },
            },
            select: { account_id: true, debit_amount: true, credit_amount: true },
        });

        const buildMap = (details: Array<{ account_id: string; debit_amount: any; credit_amount: any }>) => {
            const map = new Map<string, { debit: number; credit: number }>();
            for (const d of details) {
                const e = map.get(d.account_id) ?? { debit: 0, credit: 0 };
                e.debit += Number(d.debit_amount ?? 0);
                e.credit += Number(d.credit_amount ?? 0);
                map.set(d.account_id, e);
            }
            return map;
        };

        const openingMap = buildMap(openingDetails);
        const periodMap = buildMap(periodDetails);

        const cashBankIds = accounts
            .filter((a) => a.category === AccountCategory.CASH || a.category === AccountCategory.BANK)
            .map((a) => a.id);

        const openingCashBalance = cashBankIds.reduce((s, id) => {
            const t = openingMap.get(id) ?? { debit: 0, credit: 0 };
            return s + this.calculateSignedBalance(AccountType.ASSET, t.debit, t.credit);
        }, 0);

        const closingCashBalance = cashBankIds.reduce((s, id) => {
            const openT = openingMap.get(id) ?? { debit: 0, credit: 0 };
            const periodT = periodMap.get(id) ?? { debit: 0, credit: 0 };
            return s + this.calculateSignedBalance(AccountType.ASSET, openT.debit + periodT.debit, openT.credit + periodT.credit);
        }, 0);

        const calcNetChange = (accts: typeof accounts) => {
            return accts.map((a) => {
                const t = periodMap.get(a.id) ?? { debit: 0, credit: 0 };
                const netChange = CREDIT_NORMAL_ACCOUNT_TYPES.has(a.type as AccountType)
                    ? this.roundAmount(t.credit - t.debit)
                    : this.roundAmount(t.debit - t.credit);
                return { id: a.id, name: a.name, type: a.type, net_change: netChange };
            }).filter((r) => r.net_change !== 0);
        };

        const investingActivities = calcNetChange(investingAccounts);
        const financingActivities = calcNetChange(financingAccounts);
        const operatingActivities = calcNetChange(operatingAccounts);

        const investingNet = this.roundAmount(investingActivities.reduce((s, a) => s + a.net_change, 0));
        const financingNet = this.roundAmount(financingActivities.reduce((s, a) => s + a.net_change, 0));
        const operatingNet = this.roundAmount(operatingActivities.reduce((s, a) => s + a.net_change, 0));

        return {
            filters: { from: range.from, to: range.to },
            operating: { activities: operatingActivities, net: operatingNet },
            investing: { activities: investingActivities, net: investingNet },
            financing: { activities: financingActivities, net: financingNet },
            net_change_in_cash: this.roundAmount(operatingNet + investingNet + financingNet),
            opening_cash_balance: this.roundAmount(openingCashBalance),
            closing_cash_balance: this.roundAmount(closingCashBalance),
            note: 'Indirect method approximation based on account classification.',
        };
    }

    // ============ FEATURE 8: Fiscal Period Locking ============

    async listFiscalPeriods(tenantId: string, query: FiscalPeriodsQueryDto) {
        const now = new Date();
        const year = query.year ?? now.getUTCFullYear();

        // Auto-create 12 months if none exist
        const existing = await this.db.fiscalPeriod.findMany({
            where: { tenant_id: tenantId, year },
            orderBy: { month: 'asc' },
        });

        if (existing.length === 0) {
            const data = Array.from({ length: 12 }, (_, i) => {
                const m = i + 1;
                const start = new Date(Date.UTC(year, i, 1));
                const end = new Date(Date.UTC(year, i + 1, 0, 23, 59, 59, 999));
                return {
                    tenant_id: tenantId,
                    year,
                    month: m,
                    period_label: `${start.toLocaleString('en', { month: 'long' })} ${year}`,
                    start_date: start,
                    end_date: end,
                };
            });

            await this.db.fiscalPeriod.createMany({ data });
            return this.db.fiscalPeriod.findMany({ where: { tenant_id: tenantId, year }, orderBy: { month: 'asc' } });
        }

        return existing;
    }

    async lockFiscalPeriod(tenantId: string, dto: LockFiscalPeriodDto, userId: string) {
        const period = await this.db.fiscalPeriod.findUnique({
            where: { tenant_id_year_month: { tenant_id: tenantId, year: dto.year, month: dto.month } },
        });

        if (!period) {
            // Auto-create if missing
            await this.listFiscalPeriods(tenantId, { year: dto.year });
        }

        return this.db.fiscalPeriod.update({
            where: { tenant_id_year_month: { tenant_id: tenantId, year: dto.year, month: dto.month } },
            data: { is_locked: true, locked_at: new Date(), locked_by_user_id: userId },
        });
    }

    async unlockFiscalPeriod(tenantId: string, dto: LockFiscalPeriodDto, userId: string) {
        const period = await this.db.fiscalPeriod.findUnique({
            where: { tenant_id_year_month: { tenant_id: tenantId, year: dto.year, month: dto.month } },
        });

        if (!period) {
            throw new NotFoundException('Fiscal period not found.');
        }

        return this.db.fiscalPeriod.update({
            where: { tenant_id_year_month: { tenant_id: tenantId, year: dto.year, month: dto.month } },
            data: { is_locked: false, locked_at: null, locked_by_user_id: userId },
        });
    }

    // ============ FEATURE 9: Opening Balance Import ============

    async importOpeningBalances(tenantId: string, dto: ImportOpeningBalancesDto) {
        // Validate: each entry must have exactly one of debit/credit > 0
        for (const entry of dto.entries) {
            const hasDebit = entry.debitAmount > 0;
            const hasCredit = entry.creditAmount > 0;
            if ((hasDebit && hasCredit) || (!hasDebit && !hasCredit)) {
                throw new BadRequestException('Each entry must have either a debit or credit amount, not both or neither.');
            }
        }

        const totalDebit = dto.entries.reduce((s, e) => s + e.debitAmount, 0);
        const totalCredit = dto.entries.reduce((s, e) => s + e.creditAmount, 0);
        if (Math.abs(totalDebit - totalCredit) > 0.01) {
            throw new BadRequestException(`Opening balances must be balanced. Debit total: ${totalDebit}, Credit total: ${totalCredit}.`);
        }

        const accountIds = [...new Set(dto.entries.map((e) => e.accountId))];
        const accounts = await this.db.account.findMany({ where: { tenant_id: tenantId, id: { in: accountIds } } });
        if (accounts.length !== accountIds.length) {
            throw new BadRequestException('One or more accounts do not belong to this tenant.');
        }

        return this.db.$transaction(async (tx) => {
            const generatedNumber = await this.generateNextVoucherNumberWithClient(tx, tenantId, VoucherType.JOURNAL);
            return tx.voucher.create({
                data: {
                    tenant_id: tenantId,
                    voucher_number: generatedNumber.voucherNumber,
                    voucher_type: VoucherType.JOURNAL,
                    description: `Opening Balances as of ${dto.asOfDate}`,
                    date: new Date(dto.asOfDate),
                    details: {
                        create: dto.entries.map((e) => ({
                            account_id: e.accountId,
                            debit_amount: e.debitAmount,
                            credit_amount: e.creditAmount,
                        })),
                    },
                },
                include: {
                    details: {
                        include: { account: { include: { group: true, subgroup: true } } },
                        orderBy: { created_at: 'asc' },
                    },
                },
            });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }

    // ============ FEATURE 10: Budget vs Actual ============

    async upsertBudget(tenantId: string, dto: UpsertBudgetDto) {
        const account = await this.db.account.findFirst({ where: { id: dto.accountId, tenant_id: tenantId } });
        if (!account) throw new NotFoundException('Account not found.');

        return this.db.accountBudget.upsert({
            where: {
                tenant_id_account_id_fiscal_year_month: {
                    tenant_id: tenantId,
                    account_id: dto.accountId,
                    fiscal_year: dto.fiscalYear,
                    month: dto.month ?? null,
                },
            },
            create: {
                tenant_id: tenantId,
                account_id: dto.accountId,
                fiscal_year: dto.fiscalYear,
                month: dto.month ?? null,
                amount: dto.amount,
            },
            update: { amount: dto.amount },
        });
    }

    async getBudgetVsActual(tenantId: string, query: BudgetVsActualQueryDto) {
        const budgets = await this.db.accountBudget.findMany({
            where: {
                tenant_id: tenantId,
                fiscal_year: query.fiscalYear,
                ...(query.month !== undefined ? { month: query.month } : {}),
            },
            include: { account: { include: { group: true } } },
        });

        if (budgets.length === 0) {
            return { fiscal_year: query.fiscalYear, month: query.month ?? null, rows: [], totals: { budget: 0, actual: 0, variance: 0 } };
        }

        // Determine date range for actuals
        let fromDate: Date;
        let toDate: Date;
        if (query.month) {
            fromDate = new Date(Date.UTC(query.fiscalYear, query.month - 1, 1));
            toDate = new Date(Date.UTC(query.fiscalYear, query.month, 0, 23, 59, 59, 999));
        } else {
            fromDate = new Date(Date.UTC(query.fiscalYear, 0, 1));
            toDate = new Date(Date.UTC(query.fiscalYear, 11, 31, 23, 59, 59, 999));
        }

        const accountIds = budgets.map((b) => b.account_id);
        const details = await this.db.voucherDetail.findMany({
            where: {
                account_id: { in: accountIds },
                voucher: { tenant_id: tenantId, date: { gte: fromDate, lte: toDate } },
            },
            select: { account_id: true, debit_amount: true, credit_amount: true },
        });

        const actualMap = new Map<string, { debit: number; credit: number }>();
        for (const d of details) {
            const e = actualMap.get(d.account_id) ?? { debit: 0, credit: 0 };
            e.debit += Number(d.debit_amount ?? 0);
            e.credit += Number(d.credit_amount ?? 0);
            actualMap.set(d.account_id, e);
        }

        let totalBudget = 0;
        let totalActual = 0;

        const rows = budgets.map((budget) => {
            const t = actualMap.get(budget.account_id) ?? { debit: 0, credit: 0 };
            const accountType = budget.account.type as AccountType;
            const actual = CREDIT_NORMAL_ACCOUNT_TYPES.has(accountType)
                ? this.roundAmount(t.credit - t.debit)
                : this.roundAmount(t.debit - t.credit);
            const budgetAmount = this.roundAmount(Number(budget.amount));
            const variance = this.roundAmount(budgetAmount - actual);
            const variancePct = budgetAmount !== 0 ? this.roundAmount((variance / Math.abs(budgetAmount)) * 100) : null;

            totalBudget = this.roundAmount(totalBudget + budgetAmount);
            totalActual = this.roundAmount(totalActual + actual);

            return {
                account: {
                    id: budget.account.id,
                    name: budget.account.name,
                    code: budget.account.code,
                    type: budget.account.type,
                    group: { id: budget.account.group.id, name: budget.account.group.name },
                },
                budget: budgetAmount,
                actual,
                variance,
                variance_pct: variancePct,
            };
        });

        return {
            fiscal_year: query.fiscalYear,
            month: query.month ?? null,
            rows,
            totals: { budget: totalBudget, actual: totalActual, variance: this.roundAmount(totalBudget - totalActual) },
        };
    }

    // ============ FEATURE 11: Cost Centers ============

    async createCostCenter(tenantId: string, dto: CreateCostCenterDto) {
        const existing = await this.db.costCenter.findUnique({
            where: { tenant_id_code: { tenant_id: tenantId, code: dto.code } },
        });
        if (existing) throw new BadRequestException('A cost center with this code already exists.');

        return this.db.costCenter.create({
            data: { tenant_id: tenantId, code: dto.code, name: dto.name },
        });
    }

    async listCostCenters(tenantId: string) {
        return this.db.costCenter.findMany({
            where: { tenant_id: tenantId },
            orderBy: { code: 'asc' },
        });
    }

    async getCostCenterPL(tenantId: string, query: CostCenterPLQueryDto) {
        const costCenter = await this.db.costCenter.findFirst({
            where: { id: query.costCenterId, tenant_id: tenantId },
        });
        if (!costCenter) throw new NotFoundException('Cost center not found.');

        const range = this.resolveDateRange(query.from, query.to);

        const accounts = await this.db.account.findMany({
            where: { tenant_id: tenantId, type: { in: [AccountType.REVENUE, AccountType.EXPENSE] } },
            include: { group: true },
        });

        if (accounts.length === 0) {
            return {
                cost_center: { id: costCenter.id, name: costCenter.name, code: costCenter.code },
                filters: { from: range.from, to: range.to },
                revenue: { groups: [], total: 0 },
                expenses: { groups: [], total: 0 },
                net_profit: 0,
            };
        }

        const details = await this.db.voucherDetail.findMany({
            where: {
                cost_center_id: query.costCenterId,
                account_id: { in: accounts.map((a) => a.id) },
                voucher: { tenant_id: tenantId, date: { gte: range.fromDate, lte: range.toDate } },
            },
            select: { account_id: true, debit_amount: true, credit_amount: true },
        });

        const accountTotals = new Map<string, { debit: number; credit: number }>();
        for (const detail of details) {
            const existing = accountTotals.get(detail.account_id) ?? { debit: 0, credit: 0 };
            existing.debit += Number(detail.debit_amount ?? 0);
            existing.credit += Number(detail.credit_amount ?? 0);
            accountTotals.set(detail.account_id, existing);
        }

        const buildGroups = (accts: typeof accounts, type: AccountType) => {
            const groupMap = new Map<string, { group: any; accounts: any[]; total: number }>();
            for (const account of accts) {
                const totals = accountTotals.get(account.id) ?? { debit: 0, credit: 0 };
                const balance = type === AccountType.REVENUE
                    ? this.roundAmount(totals.credit - totals.debit)
                    : this.roundAmount(totals.debit - totals.credit);
                const gid = account.group_id;
                const existing = groupMap.get(gid) ?? { group: { id: account.group.id, name: account.group.name }, accounts: [], total: 0 };
                existing.accounts.push({ id: account.id, name: account.name, code: account.code, balance });
                existing.total = this.roundAmount(existing.total + balance);
                groupMap.set(gid, existing);
            }
            return Array.from(groupMap.values()).sort((a, b) => a.group.name.localeCompare(b.group.name));
        };

        const revenueGroups = buildGroups(accounts.filter((a) => a.type === AccountType.REVENUE), AccountType.REVENUE);
        const expenseGroups = buildGroups(accounts.filter((a) => a.type === AccountType.EXPENSE), AccountType.EXPENSE);
        const totalRevenue = this.roundAmount(revenueGroups.reduce((s, g) => s + g.total, 0));
        const totalExpenses = this.roundAmount(expenseGroups.reduce((s, g) => s + g.total, 0));

        return {
            cost_center: { id: costCenter.id, name: costCenter.name, code: costCenter.code },
            filters: { from: range.from, to: range.to },
            revenue: { groups: revenueGroups, total: totalRevenue },
            expenses: { groups: expenseGroups, total: totalExpenses },
            net_profit: this.roundAmount(totalRevenue - totalExpenses),
        };
    }

    // ============ FEATURE 12: Fixed Assets ============

    async createFixedAsset(tenantId: string, dto: CreateFixedAssetDto) {
        const existing = await this.db.fixedAsset.findUnique({
            where: { tenant_id_asset_code: { tenant_id: tenantId, asset_code: dto.assetCode } },
        });
        if (existing) throw new BadRequestException('An asset with this code already exists.');

        return this.db.fixedAsset.create({
            data: {
                tenant_id: tenantId,
                asset_code: dto.assetCode,
                name: dto.name,
                purchase_date: new Date(dto.purchaseDate),
                cost: dto.cost,
                residual_value: dto.residualValue ?? 0,
                useful_life_months: dto.usefulLifeMonths,
                depreciation_method: (dto.depreciationMethod as any) ?? 'STRAIGHT_LINE',
                asset_account_id: dto.assetAccountId,
                depreciation_account_id: dto.depreciationAccountId,
            },
        });
    }

    async listFixedAssets(tenantId: string) {
        return this.db.fixedAsset.findMany({
            where: { tenant_id: tenantId },
            include: { depreciationEntries: { orderBy: [{ period_year: 'desc' }, { period_month: 'desc' }], take: 1 } },
            orderBy: { asset_code: 'asc' },
        });
    }

    async runDepreciation(tenantId: string, dto: RunDepreciationDto) {
        const assets = await this.db.fixedAsset.findMany({
            where: { tenant_id: tenantId, is_active: true },
        });

        const results = [];
        for (const asset of assets) {
            // Check if already run for this period
            const existing = await this.db.assetDepreciationEntry.findUnique({
                where: { asset_id_period_year_period_month: { asset_id: asset.id, period_year: dto.year, period_month: dto.month } },
            });
            if (existing) continue;

            const cost = Number(asset.cost);
            const residual = Number(asset.residual_value);
            const accum = Number(asset.accumulated_depreciation);
            let depreciation = 0;

            if (asset.depreciation_method === 'STRAIGHT_LINE') {
                depreciation = this.roundAmount((cost - residual) / asset.useful_life_months);
            } else {
                // Declining balance: 2 / useful_life_months applied to book value
                const bookValue = cost - accum;
                const rate = 2 / asset.useful_life_months;
                depreciation = this.roundAmount(bookValue * rate);
            }

            // Don't depreciate below residual value
            const maxDepreciation = this.roundAmount(cost - residual - accum);
            if (maxDepreciation <= 0) continue;
            depreciation = Math.min(depreciation, maxDepreciation);
            if (depreciation <= 0) continue;

            // Record entry
            const entry = await this.db.assetDepreciationEntry.create({
                data: {
                    asset_id: asset.id,
                    period_year: dto.year,
                    period_month: dto.month,
                    depreciation_amount: depreciation,
                },
            });

            // Update accumulated depreciation
            await this.db.fixedAsset.update({
                where: { id: asset.id },
                data: { accumulated_depreciation: { increment: depreciation } },
            });

            results.push({ asset: { id: asset.id, name: asset.name, asset_code: asset.asset_code }, depreciation_amount: depreciation, entry_id: entry.id });
        }

        return { period: `${dto.year}-${String(dto.month).padStart(2, '0')}`, processed: results.length, results };
    }

    async getDepreciationSchedule(tenantId: string, assetId: string) {
        const asset = await this.db.fixedAsset.findFirst({
            where: { id: assetId, tenant_id: tenantId },
            include: { depreciationEntries: { orderBy: [{ period_year: 'asc' }, { period_month: 'asc' }] } },
        });
        if (!asset) throw new NotFoundException('Fixed asset not found.');

        const cost = Number(asset.cost);
        const residual = Number(asset.residual_value);
        const existingEntries = asset.depreciationEntries;

        const schedule = [];
        let accum = 0;
        let bookValue = cost;

        for (let i = 0; i < asset.useful_life_months; i++) {
            const purchaseDate = new Date(asset.purchase_date);
            const periodDate = new Date(Date.UTC(purchaseDate.getUTCFullYear(), purchaseDate.getUTCMonth() + i, 1));
            const year = periodDate.getUTCFullYear();
            const month = periodDate.getUTCMonth() + 1;

            let depreciation = 0;
            if (asset.depreciation_method === 'STRAIGHT_LINE') {
                depreciation = this.roundAmount((cost - residual) / asset.useful_life_months);
            } else {
                const rate = 2 / asset.useful_life_months;
                depreciation = this.roundAmount(bookValue * rate);
            }

            const maxDepreciation = this.roundAmount(cost - residual - accum);
            if (maxDepreciation <= 0) break;
            depreciation = Math.min(depreciation, maxDepreciation);

            accum = this.roundAmount(accum + depreciation);
            bookValue = this.roundAmount(cost - accum);

            const existing = existingEntries.find((e) => e.period_year === year && e.period_month === month);
            schedule.push({ year, month, depreciation, accumulated_depreciation: accum, book_value: bookValue, posted: !!existing });
        }

        return {
            asset: { id: asset.id, name: asset.name, asset_code: asset.asset_code, cost, residual_value: residual, useful_life_months: asset.useful_life_months, depreciation_method: asset.depreciation_method },
            schedule,
        };
    }

    // ============ FEATURE 13: Recurring Journals ============

    async createRecurringJournal(tenantId: string, dto: CreateRecurringJournalDto) {
        const accountIds = [...new Set(dto.lines.map((l) => l.accountId))];
        const accounts = await this.db.account.findMany({ where: { tenant_id: tenantId, id: { in: accountIds } } });
        if (accounts.length !== accountIds.length) {
            throw new BadRequestException('One or more accounts do not belong to this tenant.');
        }

        return this.db.recurringJournal.create({
            data: {
                tenant_id: tenantId,
                name: dto.name,
                description: dto.description,
                frequency: dto.frequency,
                next_due_date: new Date(dto.nextDueDate),
                lines: {
                    create: dto.lines.map((l) => ({
                        account_id: l.accountId,
                        debit_amount: l.debitAmount,
                        credit_amount: l.creditAmount,
                        comment: l.comment,
                    })),
                },
            },
            include: { lines: { include: { account: true } } },
        });
    }

    async listRecurringJournals(tenantId: string) {
        return this.db.recurringJournal.findMany({
            where: { tenant_id: tenantId },
            include: { lines: { include: { account: { select: { id: true, name: true, code: true } } } } },
            orderBy: { next_due_date: 'asc' },
        });
    }

    async postRecurringJournal(tenantId: string, id: string) {
        const template = await this.db.recurringJournal.findFirst({
            where: { id, tenant_id: tenantId },
            include: { lines: true },
        });
        if (!template) throw new NotFoundException('Recurring journal not found.');
        if (!template.is_active) throw new BadRequestException('Recurring journal is not active.');

        const voucherDto: CreateVoucherDto = {
            voucherType: VoucherType.JOURNAL,
            description: template.description ?? template.name,
            details: template.lines.map((l) => ({
                accountId: l.account_id,
                debitAmount: Number(l.debit_amount),
                creditAmount: Number(l.credit_amount),
                comment: l.comment ?? undefined,
            })),
        };

        const voucher = await this.createVoucher(tenantId, voucherDto);

        // Advance next_due_date
        const nextDue = new Date(template.next_due_date);
        if (template.frequency === 'DAILY') nextDue.setUTCDate(nextDue.getUTCDate() + 1);
        else if (template.frequency === 'WEEKLY') nextDue.setUTCDate(nextDue.getUTCDate() + 7);
        else nextDue.setUTCMonth(nextDue.getUTCMonth() + 1);

        await this.db.recurringJournal.update({
            where: { id },
            data: { last_run_date: new Date(), next_due_date: nextDue },
        });

        return { voucher, next_due_date: nextDue };
    }

    // ============ Recurring Vouchers (any voucher type) ============

    async createRecurringVoucher(tenantId: string, dto: CreateRecurringVoucherDto) {
        const accountIds = [...new Set(dto.lines.map((l) => l.accountId))];
        const accounts = await this.db.account.findMany({ where: { tenant_id: tenantId, id: { in: accountIds } } });
        if (accounts.length !== accountIds.length) {
            throw new BadRequestException('One or more accounts do not belong to this tenant.');
        }

        return this.db.recurringVoucher.create({
            data: {
                tenant_id: tenantId,
                name: dto.name,
                description: dto.description,
                voucher_type: dto.voucherType ?? VoucherType.JOURNAL,
                frequency: dto.frequency,
                next_due_date: new Date(dto.nextDueDate),
                lines: {
                    create: dto.lines.map((l) => ({
                        account_id: l.accountId,
                        debit_amount: l.debitAmount,
                        credit_amount: l.creditAmount,
                        comment: l.comment,
                    })),
                },
            },
            include: { lines: { include: { account: true } } },
        });
    }

    async listRecurringVouchers(tenantId: string, voucherType?: VoucherType) {
        return this.db.recurringVoucher.findMany({
            where: { tenant_id: tenantId, ...(voucherType ? { voucher_type: voucherType } : {}) },
            include: { lines: { include: { account: { select: { id: true, name: true, code: true } } } } },
            orderBy: { next_due_date: 'asc' },
        });
    }

    async postRecurringVoucher(tenantId: string, id: string) {
        const template = await this.db.recurringVoucher.findFirst({
            where: { id, tenant_id: tenantId },
            include: { lines: true },
        });
        if (!template) throw new NotFoundException('Recurring voucher not found.');
        if (!template.is_active) throw new BadRequestException('Recurring voucher is not active.');

        const voucherDto: CreateVoucherDto = {
            voucherType: template.voucher_type as VoucherType,
            description: template.description ?? template.name,
            details: template.lines.map((l) => ({
                accountId: l.account_id,
                debitAmount: Number(l.debit_amount),
                creditAmount: Number(l.credit_amount),
                comment: l.comment ?? undefined,
            })),
        };

        const voucher = await this.createVoucher(tenantId, voucherDto);

        // Advance next_due_date
        const nextDue = new Date(template.next_due_date);
        if (template.frequency === 'DAILY') nextDue.setUTCDate(nextDue.getUTCDate() + 1);
        else if (template.frequency === 'WEEKLY') nextDue.setUTCDate(nextDue.getUTCDate() + 7);
        else nextDue.setUTCMonth(nextDue.getUTCMonth() + 1);

        await this.db.recurringVoucher.update({
            where: { id },
            data: { last_run_date: new Date(), next_due_date: nextDue },
        });

        return { voucher, next_due_date: nextDue };
    }

    async deleteRecurringVoucher(tenantId: string, id: string) {
        const existing = await this.db.recurringVoucher.findFirst({ where: { id, tenant_id: tenantId } });
        if (!existing) throw new NotFoundException('Recurring voucher not found.');
        await this.db.recurringVoucher.delete({ where: { id } });
        return { success: true };
    }

    /** Auto-posts every active recurring voucher whose next_due_date has arrived. */
    async postAllDueRecurringVouchers(): Promise<{ posted: number; failed: number }> {
        const due = await this.db.recurringVoucher.findMany({
            where: { is_active: true, next_due_date: { lte: new Date() } },
        });

        let posted = 0;
        let failed = 0;
        for (const recurringVoucher of due) {
            try {
                await this.postRecurringVoucher(recurringVoucher.tenant_id, recurringVoucher.id);
                posted++;
            } catch (err) {
                failed++;
                this.logger.error(
                    `Failed to auto-post recurring voucher ${recurringVoucher.id}: ${err instanceof Error ? err.message : err}`,
                );
            }
        }

        return { posted, failed };
    }

    @Cron('0 6 * * *')
    async runDueRecurringVouchers(): Promise<void> {
        await this.jobTracker.track(JOB_NAMES.ACCOUNTING_RECURRING_VOUCHERS, () => this.postAllDueRecurringVouchers());
    }

    // ============ Voucher Templates ============

    async createVoucherTemplate(tenantId: string, dto: CreateVoucherTemplateDto) {
        const accountIds = [...new Set(dto.lines.map((l) => l.accountId))];
        const accounts = await this.db.account.findMany({ where: { tenant_id: tenantId, id: { in: accountIds } } });
        if (accounts.length !== accountIds.length) {
            throw new BadRequestException('One or more accounts do not belong to this tenant.');
        }

        return this.db.voucherTemplate.create({
            data: {
                tenant_id: tenantId,
                name: dto.name,
                description: dto.description,
                voucher_type: dto.voucherType,
                lines: {
                    create: dto.lines.map((l) => ({
                        account_id: l.accountId,
                        debit_amount: l.debitAmount,
                        credit_amount: l.creditAmount,
                        comment: l.comment,
                    })),
                },
            },
            include: { lines: { include: { account: true } } },
        });
    }

    async listVoucherTemplates(tenantId: string, voucherType?: VoucherType) {
        return this.db.voucherTemplate.findMany({
            where: { tenant_id: tenantId, ...(voucherType ? { voucher_type: voucherType } : {}) },
            include: { lines: { include: { account: { select: { id: true, name: true, code: true } } } } },
            orderBy: { name: 'asc' },
        });
    }

    async getVoucherTemplate(tenantId: string, id: string) {
        const template = await this.db.voucherTemplate.findFirst({
            where: { id, tenant_id: tenantId },
            include: { lines: { include: { account: { select: { id: true, name: true, code: true } } } } },
        });
        if (!template) throw new NotFoundException('Voucher template not found.');
        return template;
    }

    async deleteVoucherTemplate(tenantId: string, id: string) {
        const existing = await this.db.voucherTemplate.findFirst({ where: { id, tenant_id: tenantId } });
        if (!existing) throw new NotFoundException('Voucher template not found.');
        await this.db.voucherTemplate.delete({ where: { id } });
        return { success: true };
    }

    // ============ FEATURE 14: Bank Reconciliation ============

    async createBankReconciliation(tenantId: string, dto: CreateBankReconciliationDto) {
        const account = await this.db.account.findFirst({
            where: { id: dto.accountId, tenant_id: tenantId, category: AccountCategory.BANK },
        });
        if (!account) throw new NotFoundException('Bank account not found.');

        return this.db.bankReconciliation.create({
            data: {
                tenant_id: tenantId,
                account_id: dto.accountId,
                statement_date: new Date(dto.statementDate),
                statement_closing_balance: dto.statementClosingBalance,
            },
        });
    }

    async importBankStatementEntries(tenantId: string, dto: ImportBankStatementDto) {
        const recon = await this.db.bankReconciliation.findFirst({
            where: { id: dto.reconciliationId, tenant_id: tenantId },
        });
        if (!recon) throw new NotFoundException('Bank reconciliation not found.');

        await this.db.bankStatementEntry.createMany({
            data: dto.entries.map((e) => ({
                reconciliation_id: dto.reconciliationId,
                entry_date: new Date(e.entryDate),
                description: e.description,
                amount: e.amount,
                entry_type: e.entryType,
            })),
        });

        return { imported: dto.entries.length };
    }

    async autoMatchBankEntries(tenantId: string, reconciliationId: string) {
        const recon = await this.db.bankReconciliation.findFirst({
            where: { id: reconciliationId, tenant_id: tenantId },
        });
        if (!recon) throw new NotFoundException('Bank reconciliation not found.');

        const unmatchedEntries = await this.db.bankStatementEntry.findMany({
            where: { reconciliation_id: reconciliationId, is_matched: false },
        });

        // Get voucher details for the bank account in the period
        const voucherDetails = await this.db.voucherDetail.findMany({
            where: {
                account_id: recon.account_id,
                voucher: { tenant_id: tenantId },
            },
            include: { voucher: { select: { date: true } } },
        });

        let matched = 0;
        for (const entry of unmatchedEntries) {
            const entryDate = entry.entry_date;
            const amount = Number(entry.amount);

            // Find matching voucher detail by date and amount
            const match = voucherDetails.find((vd) => {
                const vdDate = vd.voucher.date;
                const sameDayMs = Math.abs(vdDate.getTime() - entryDate.getTime()) < 86400000 * 2;
                const debit = Number(vd.debit_amount ?? 0);
                const credit = Number(vd.credit_amount ?? 0);
                const vdAmount = entry.entry_type === 'DEBIT' ? debit : credit;
                return sameDayMs && Math.abs(vdAmount - amount) < 0.01;
            });

            if (match) {
                await this.db.bankStatementEntry.update({
                    where: { id: entry.id },
                    data: { is_matched: true, matched_voucher_detail_id: match.id },
                });
                matched++;
            }
        }

        return { matched, total: unmatchedEntries.length };
    }

    async matchBankEntry(tenantId: string, dto: MatchBankEntryDto) {
        const recon = await this.db.bankStatementEntry.findFirst({
            where: { id: dto.statementEntryId, reconciliation: { tenant_id: tenantId } },
        });
        if (!recon) throw new NotFoundException('Statement entry not found.');

        return this.db.bankStatementEntry.update({
            where: { id: dto.statementEntryId },
            data: { is_matched: true, matched_voucher_detail_id: dto.voucherDetailId },
        });
    }

    async getBankReconciliationReport(tenantId: string, reconciliationId: string) {
        const recon = await this.db.bankReconciliation.findFirst({
            where: { id: reconciliationId, tenant_id: tenantId },
            include: {
                entries: {
                    orderBy: { entry_date: 'asc' },
                },
            },
        });
        if (!recon) throw new NotFoundException('Bank reconciliation not found.');

        // Get book balance for the account up to statement date
        const bookTotals = await this.db.voucherDetail.aggregate({
            where: {
                account_id: recon.account_id,
                voucher: { tenant_id: tenantId, date: { lte: recon.statement_date } },
            },
            _sum: { debit_amount: true, credit_amount: true },
        });

        const bookBalance = this.roundAmount(
            Number(bookTotals._sum.debit_amount ?? 0) - Number(bookTotals._sum.credit_amount ?? 0),
        );
        const statementBalance = Number(recon.statement_closing_balance);
        const difference = this.roundAmount(statementBalance - bookBalance);

        const matched = recon.entries.filter((e) => e.is_matched);
        const unmatched = recon.entries.filter((e) => !e.is_matched);

        return {
            reconciliation: {
                id: recon.id,
                account_id: recon.account_id,
                statement_date: recon.statement_date,
                status: recon.status,
            },
            summary: {
                book_balance: bookBalance,
                statement_balance: statementBalance,
                difference,
                is_reconciled: Math.abs(difference) < 0.01,
                total_entries: recon.entries.length,
                matched_entries: matched.length,
                unmatched_entries: unmatched.length,
            },
            matched_entries: matched.map((e) => ({
                id: e.id,
                entry_date: e.entry_date,
                description: e.description,
                amount: Number(e.amount),
                entry_type: e.entry_type,
                matched_voucher_detail_id: e.matched_voucher_detail_id,
            })),
            unmatched_entries: unmatched.map((e) => ({
                id: e.id,
                entry_date: e.entry_date,
                description: e.description,
                amount: Number(e.amount),
                entry_type: e.entry_type,
            })),
        };
    }

    private async buildBookReport(
        tenantId: string,
        category: AccountCategory,
        query: CashbookQueryDto | BankbookQueryDto,
    ) {
        this.validateDateRange(query.from, query.to);
        const range = this.resolveDateRange(query.from, query.to);

        const bookAccounts = await this.db.account.findMany({
            where: {
                tenant_id: tenantId,
                category,
                ...(query.accountId ? { id: query.accountId } : {}),
            },
        });

        if (bookAccounts.length === 0) {
            return {
                filters: { from: range.from, to: range.to },
                accounts: [],
                opening_balance: 0,
                opening_balance_side: 'neutral' as const,
                closing_balance: 0,
                closing_balance_side: 'neutral' as const,
                totals: { receipts: 0, payments: 0 },
                rows: [],
            };
        }

        const accountIds = bookAccounts.map((a) => a.id);

        const openingTotals = await this.db.voucherDetail.aggregate({
            where: {
                account_id: { in: accountIds },
                voucher: { tenant_id: tenantId, date: { lt: range.fromDate } },
            },
            _sum: { debit_amount: true, credit_amount: true },
        });

        const openingDebit = Number(openingTotals._sum.debit_amount ?? 0);
        const openingCredit = Number(openingTotals._sum.credit_amount ?? 0);
        const openingBalanceValue = this.roundAmount(openingDebit - openingCredit);
        const openingBalance = this.presentBalance(AccountType.ASSET, openingBalanceValue);

        const entries = await this.db.voucherDetail.findMany({
            where: {
                account_id: { in: accountIds },
                voucher: { tenant_id: tenantId, ...this.buildVoucherDateRangeFilter(range.from, range.to) },
            },
            include: {
                voucher: true,
                account: { select: { id: true, name: true } },
            },
            orderBy: [{ voucher: { date: 'asc' } }, { voucher_id: 'asc' }, { created_at: 'asc' }],
        });

        let runningBalanceValue = openingBalanceValue;
        let totalReceipts = 0;
        let totalPayments = 0;

        const rows = entries.map((entry) => {
            const receipts = Number(entry.debit_amount ?? 0);
            const payments = Number(entry.credit_amount ?? 0);
            totalReceipts = this.roundAmount(totalReceipts + receipts);
            totalPayments = this.roundAmount(totalPayments + payments);
            runningBalanceValue = this.roundAmount(runningBalanceValue + receipts - payments);
            const balance = this.presentBalance(AccountType.ASSET, runningBalanceValue);
            return {
                id: entry.id,
                voucher_id: entry.voucher_id,
                voucher_number: entry.voucher.voucher_number,
                voucher_type: entry.voucher.voucher_type,
                date: entry.voucher.date,
                description: entry.comment ?? entry.voucher.description ?? null,
                reference_number: entry.voucher.reference_number,
                account_name: entry.account.name,
                receipts,
                payments,
                running_balance: balance.amount,
                running_balance_side: balance.side,
            };
        });

        const closingBalance = this.presentBalance(AccountType.ASSET, runningBalanceValue);

        return {
            filters: { from: range.from, to: range.to },
            accounts: bookAccounts.map((a) => ({ id: a.id, name: a.name, code: a.code })),
            opening_balance: openingBalance.amount,
            opening_balance_side: openingBalance.side,
            closing_balance: closingBalance.amount,
            closing_balance_side: closingBalance.side,
            totals: { receipts: totalReceipts, payments: totalPayments },
            rows,
        };
    }

    async getCashbook(tenantId: string, query: CashbookQueryDto) {
        return this.buildBookReport(tenantId, AccountCategory.CASH, query);
    }

    async getBankbook(tenantId: string, query: BankbookQueryDto) {
        return this.buildBookReport(tenantId, AccountCategory.BANK, query);
    }

    async exportLedger(tenantId: string, format: 'tally' | 'quickbooks', from?: string, to?: string): Promise<string> {
        this.validateDateRange(from, to);

        const vouchers = await this.db.voucher.findMany({
            where: {
                tenant_id: tenantId,
                ...this.buildVoucherDateRangeFilter(from, to),
            },
            include: {
                details: {
                    include: {
                        account: true,
                    },
                    orderBy: { created_at: 'asc' },
                },
            },
            orderBy: [{ date: 'asc' }, { created_at: 'asc' }],
        });

        if (format === 'tally') {
            return this.buildTallyXml(vouchers);
        }

        return this.buildQuickBooksIif(vouchers);
    }

    private buildTallyXml(vouchers: Array<{
        id: string;
        date: Date;
        description: string | null;
        voucher_number: string;
        details: Array<{
            account: { name: string };
            debit_amount: any;
            credit_amount: any;
        }>;
    }>): string {
        const escapeXml = (str: string) =>
            str
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&apos;');

        const voucherMessages = vouchers.map((voucher) => {
            const date = voucher.date
                .toISOString()
                .slice(0, 10)
                .replace(/-/g, '');

            const narration = escapeXml(voucher.description ?? voucher.voucher_number);

            const ledgerLines = voucher.details.map((detail) => {
                const debit = Number(detail.debit_amount ?? 0);
                const credit = Number(detail.credit_amount ?? 0);
                const isDebit = debit > 0;
                // In Tally: debit entries are negative amounts with ISDEEMEDPOSITIVE=Yes
                // credit entries are positive amounts with ISDEEMEDPOSITIVE=No
                const amount = isDebit ? -debit : credit;
                const isDeemedPositive = isDebit ? 'Yes' : 'No';

                return `        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>${escapeXml(detail.account.name)}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>${isDeemedPositive}</ISDEEMEDPOSITIVE>
          <AMOUNT>${amount.toFixed(2)}</AMOUNT>
        </ALLLEDGERENTRIES.LIST>`;
            }).join('\n');

            return `      <TALLYMESSAGE xmlns:UDF="TallyUDF">
        <VOUCHER VCHTYPE="Journal" ACTION="Create">
          <DATE>${date}</DATE>
          <NARRATION>${narration}</NARRATION>
${ledgerLines}
        </VOUCHER>
      </TALLYMESSAGE>`;
        }).join('\n');

        return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
      </REQUESTDESC>
      <REQUESTDATA>
${voucherMessages}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
    }

    private buildQuickBooksIif(vouchers: Array<{
        id: string;
        date: Date;
        description: string | null;
        voucher_number: string;
        details: Array<{
            account: { name: string };
            debit_amount: any;
            credit_amount: any;
        }>;
    }>): string {
        const formatDate = (date: Date) => {
            const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
            const dd = String(date.getUTCDate()).padStart(2, '0');
            const yyyy = date.getUTCFullYear();
            return `${mm}/${dd}/${yyyy}`;
        };

        const lines: string[] = [
            '!TRNS\tTRNSID\tTRNSTYPE\tDATE\tACCNT\tAMOUNT\tMEMO',
            '!SPL\tSPLID\tTRNSTYPE\tDATE\tACCNT\tAMOUNT\tMEMO',
            '!ENDTRNS',
        ];

        vouchers.forEach((voucher, voucherIndex) => {
            const trnsId = voucherIndex + 1;
            const dateStr = formatDate(voucher.date);
            const memo = voucher.description ?? voucher.voucher_number;
            const trnsType = 'GENERAL JOURNAL';

            voucher.details.forEach((detail, detailIndex) => {
                const debit = Number(detail.debit_amount ?? 0);
                const credit = Number(detail.credit_amount ?? 0);
                // In QuickBooks IIF: TRNS line holds the debit side (positive),
                // SPL lines hold the credit side (negative)
                const amount = debit > 0 ? debit : -credit;
                const tag = detailIndex === 0 ? 'TRNS' : 'SPL';
                const splId = detailIndex === 0 ? trnsId : detailIndex;

                lines.push(`${tag}\t${splId}\t${trnsType}\t${dateStr}\t${detail.account.name}\t${amount.toFixed(2)}\t${memo}`);
            });

            lines.push('ENDTRNS');
        });

        return lines.join('\r\n');
    }

    private formatVoucherNumber(voucherType: VoucherType, sequenceNumber: number) {
        return `${VOUCHER_NUMBER_PREFIXES[voucherType]}-${String(sequenceNumber).padStart(VOUCHER_NUMBER_PADDING, '0')}`;
    }

    private buildVoucherDateRangeFilter(from?: string, to?: string) {
        if (!from && !to) {
            return {};
        }

        return {
            date: {
                ...(from ? { gte: this.toStartOfDay(from) } : {}),
                ...(to ? { lte: this.toEndOfDay(to) } : {}),
            },
        };
    }

    private async aggregateVoucherDetailTotals(
        tenantId: string,
        accountIds: string[],
        fromDate: Date,
        toDate: Date,
    ) {
        if (accountIds.length === 0) {
            return {
                debit: 0,
                credit: 0,
            };
        }

        const totals = await this.db.voucherDetail.aggregate({
            where: {
                account_id: { in: accountIds },
                voucher: {
                    tenant_id: tenantId,
                    date: {
                        gte: fromDate,
                        lte: toDate,
                    },
                },
            },
            _sum: {
                debit_amount: true,
                credit_amount: true,
            },
        });

        return {
            debit: this.roundAmount(Number(totals._sum.debit_amount ?? 0)),
            credit: this.roundAmount(Number(totals._sum.credit_amount ?? 0)),
        };
    }

    private async getFinancialDashboardAccountIds(tenantId: string) {
        const accounts = await this.db.account.findMany({
            where: {
                tenant_id: tenantId,
            },
            select: {
                id: true,
                type: true,
                category: true,
                name: true,
                code: true,
            },
        });

        const liquidityCategories: AccountCategory[] = [AccountCategory.CASH, AccountCategory.BANK];

        const liquidityAccountIds = accounts
            .filter((account) => liquidityCategories.includes(account.category as AccountCategory))
            .map((account) => account.id);
        const revenueAccountIds = accounts
            .filter((account) => account.type === AccountType.REVENUE)
            .map((account) => account.id);
        const expenseAccountIds = accounts
            .filter((account) => account.type === AccountType.EXPENSE)
            .map((account) => account.id);
        const taxLiabilityAccountIds = accounts
            .filter((account) => account.type === AccountType.LIABILITY)
            .filter((account) => this.matchesAccountPattern(account, TAX_LIABILITY_ACCOUNT_PATTERN))
            .map((account) => account.id);
        const payableAccountIds = accounts
            .filter((account) => account.type === AccountType.LIABILITY)
            .filter((account) => this.matchesAccountPattern(account, PAYABLE_ACCOUNT_PATTERN))
            .filter((account) => !taxLiabilityAccountIds.includes(account.id))
            .map((account) => account.id);
        const receivableAccountIds = accounts
            .filter((account) => account.type === AccountType.ASSET)
            .filter((account) => this.matchesAccountPattern(account, RECEIVABLE_ACCOUNT_PATTERN))
            .map((account) => account.id);

        return {
            liquidityAccountIds,
            revenueAccountIds,
            expenseAccountIds,
            receivableAccountIds,
            payableAccountIds,
            taxLiabilityAccountIds,
        };
    }

    private async generateNextVoucherNumberWithClient(
        tx: Prisma.TransactionClient,
        tenantId: string,
        voucherType: VoucherType,
    ) {
        await tx.voucherSequence.upsert({
            where: {
                tenant_id_voucher_type: {
                    tenant_id: tenantId,
                    voucher_type: voucherType,
                },
            },
            update: {},
            create: {
                id: `${tenantId}:${voucherType}`,
                tenant_id: tenantId,
                voucher_type: voucherType,
                prefix: VOUCHER_NUMBER_PREFIXES[voucherType],
                next_number: 1,
            },
        });

        const updatedSequence = await tx.voucherSequence.update({
            where: {
                tenant_id_voucher_type: {
                    tenant_id: tenantId,
                    voucher_type: voucherType,
                },
            },
            data: {
                prefix: VOUCHER_NUMBER_PREFIXES[voucherType],
                next_number: {
                    increment: 1,
                },
            },
        });

        const sequenceNumber = updatedSequence.next_number - 1;
        return {
            tenantId,
            voucherType,
            prefix: updatedSequence.prefix,
            sequenceNumber,
            voucherNumber: this.formatVoucherNumber(voucherType, sequenceNumber),
        };
    }

    private validateVoucherDetails(dto: CreateVoucherDto) {
        let totalDebit = 0;
        let totalCredit = 0;

        for (const detail of dto.details) {
            const debit = Number(detail.debitAmount);
            const credit = Number(detail.creditAmount);
            const hasDebit = debit > 0;
            const hasCredit = credit > 0;

            if (Number.isNaN(debit) || Number.isNaN(credit)) {
                throw new BadRequestException('Voucher amounts must be valid numbers.');
            }

            if ((hasDebit && hasCredit) || (!hasDebit && !hasCredit)) {
                throw new BadRequestException('Each voucher row must contain either a debit amount or a credit amount.');
            }

            totalDebit += debit;
            totalCredit += credit;
        }

        if (Math.abs(totalDebit - totalCredit) > 0.0001) {
            throw new BadRequestException('Voucher debits and credits must balance.');
        }
    }

    private validateVoucherTypeRules(dto: CreateVoucherDto, accounts: Array<{ id: string; category: string }>) {
        const accountById = new Map(accounts.map((account) => [account.id, account]));
        const detailAccounts = dto.details.map((detail) => accountById.get(detail.accountId)).filter(Boolean) as Array<{ id: string; category: string }>;

        if (dto.voucherType === VoucherType.CASH_PAYMENT || dto.voucherType === VoucherType.CASH_RECEIVE) {
            if (!detailAccounts.some((account) => account.category === AccountCategory.CASH)) {
                throw new BadRequestException('Cash vouchers require at least one cash account line.');
            }
        }

        if (dto.voucherType === VoucherType.BANK_PAYMENT || dto.voucherType === VoucherType.BANK_RECEIVE) {
            if (!detailAccounts.some((account) => account.category === AccountCategory.BANK)) {
                throw new BadRequestException('Bank vouchers require at least one bank account line.');
            }
        }

        if (dto.voucherType === VoucherType.FUND_TRANSFER) {
            const validCategories = new Set<AccountCategory>([AccountCategory.CASH, AccountCategory.BANK]);
            if (!detailAccounts.every((account) => validCategories.has(account.category as AccountCategory))) {
                throw new BadRequestException('Fund transfer vouchers can only use cash or bank accounts.');
            }
        }
    }

    private isRetryableVoucherSequenceError(error: unknown) {
        return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
    }

    private validateDateRange(from?: string, to?: string) {
        if (!from || !to) {
            return;
        }

        if (this.toStartOfDay(from) > this.toEndOfDay(to)) {
            throw new BadRequestException('The from date must be on or before the to date.');
        }
    }

    private resolveDateRange(from?: string, to?: string) {
        this.validateDateRange(from, to);

        const now = new Date();
        const resolvedFrom = from ?? this.formatDateValue(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
        const resolvedTo = to ?? this.formatDateValue(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)));

        return {
            from: resolvedFrom,
            to: resolvedTo,
            fromDate: this.toStartOfDay(resolvedFrom),
            toDate: this.toEndOfDay(resolvedTo),
        };
    }

    private toStartOfDay(value: string) {
        const date = new Date(value);
        date.setUTCHours(0, 0, 0, 0);
        return date;
    }

    private toEndOfDay(value: string) {
        const date = new Date(value);
        date.setUTCHours(23, 59, 59, 999);
        return date;
    }

    private formatDateValue(value: Date) {
        return value.toISOString().slice(0, 10);
    }

    private enumerateDateRange(fromDate: Date, toDate: Date) {
        const dates: Date[] = [];
        const cursor = new Date(fromDate);

        while (cursor <= toDate) {
            dates.push(new Date(cursor));
            cursor.setUTCDate(cursor.getUTCDate() + 1);
        }

        return dates;
    }

    private matchesAccountPattern(
        account: { name?: string | null; code?: string | null },
        pattern: RegExp,
    ) {
        return pattern.test(`${account.name ?? ''} ${account.code ?? ''}`.trim());
    }

    private calculateSignedBalance(accountType: AccountType, debitAmount: number, creditAmount: number) {
        if (CREDIT_NORMAL_ACCOUNT_TYPES.has(accountType)) {
            return this.roundAmount(creditAmount - debitAmount);
        }

        return this.roundAmount(debitAmount - creditAmount);
    }

    private getNormalBalanceSide(accountType: AccountType) {
        return CREDIT_NORMAL_ACCOUNT_TYPES.has(accountType) ? 'credit' : 'debit';
    }

    private presentBalance(accountType: AccountType, balanceValue: number) {
        if (Math.abs(balanceValue) < 0.0001) {
            return {
                amount: 0,
                side: 'neutral' as const,
            };
        }

        const normalBalanceSide = this.getNormalBalanceSide(accountType);

        return {
            amount: this.roundAmount(Math.abs(balanceValue)),
            side: balanceValue >= 0
                ? normalBalanceSide
                : normalBalanceSide === 'debit'
                    ? 'credit' as const
                    : 'debit' as const,
        };
    }

    private roundAmount(value: number) {
        return Math.round(value * 100) / 100;
    }

    private serializeVoucher(voucher: any) {
        const totalAmount = voucher.details.reduce(
            (sum: number, detail: any) => sum + Number(detail.debit_amount || 0),
            0,
        );

        return {
            ...voucher,
            total_amount: totalAmount,
            source: {
                module: voucher.source_module ?? null,
                type: voucher.source_type ?? null,
                id: voucher.source_id ?? null,
            },
        };
    }
}