import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import { AccountCategory, AccountType, VoucherType } from './accounting.constants';
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
    constructor(private readonly db: DatabaseService) {}

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

    async createVoucher(tenantId: string, dto: CreateVoucherDto, attempt = 1) {
        this.validateVoucherDetails(dto);

        try {
            return await this.db.$transaction(async (tx) => {
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
        } catch (error) {
            if (this.isRetryableVoucherSequenceError(error) && attempt < 3) {
                return this.createVoucher(tenantId, dto, attempt + 1);
            }

            throw error;
        }
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