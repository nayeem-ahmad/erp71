import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { paginate, PaginatedResult } from '../common/pagination.dto';
import { createdAtRange } from '../common/created-range.util';
import { autoPostFromRules } from '../accounting/posting.utils';
import {
    CreateExpenseCategoryDto,
    CreateExpenseEntryDto,
    CreateExpenseHeadDto,
    ExpenseReportQueryDto,
    ListExpenseEntriesQueryDto,
    UpdateExpenseCategoryDto,
    UpdateExpenseEntryDto,
    UpdateExpenseHeadDto,
} from './expenses.dto';

@Injectable()
export class ExpensesService {
    constructor(private db: DatabaseService) {}

    async listCategories(tenantId: string) {
        return this.db.expenseCategory.findMany({
            where: { tenant_id: tenantId },
            include: {
                _count: { select: { entries: true, heads: true } },
                account: { select: { id: true, name: true, code: true } },
                heads: {
                    orderBy: { name: 'asc' },
                    include: {
                        _count: { select: { entries: true } },
                        account: { select: { id: true, name: true, code: true } },
                    },
                },
            },
            orderBy: { name: 'asc' },
        });
    }

    async createCategory(tenantId: string, dto: CreateExpenseCategoryDto) {
        const existing = await this.db.expenseCategory.findUnique({
            where: { tenant_id_name: { tenant_id: tenantId, name: dto.name } },
        });
        if (existing) {
            throw new BadRequestException('An expense category with this name already exists.');
        }
        if (dto.accountId) {
            await this.assertExpenseAccount(tenantId, dto.accountId);
        }

        return this.db.expenseCategory.create({
            data: {
                tenant_id: tenantId,
                name: dto.name,
                description: dto.description,
                account_id: dto.accountId || null,
            },
            include: { account: { select: { id: true, name: true, code: true } } },
        });
    }

    async updateCategory(tenantId: string, id: string, dto: UpdateExpenseCategoryDto) {
        await this.assertCategoryExists(tenantId, id);

        if (dto.name) {
            const duplicate = await this.db.expenseCategory.findFirst({
                where: { tenant_id: tenantId, name: dto.name, NOT: { id } },
            });
            if (duplicate) {
                throw new BadRequestException('An expense category with this name already exists.');
            }
        }
        if (dto.accountId) {
            await this.assertExpenseAccount(tenantId, dto.accountId);
        }

        return this.db.expenseCategory.update({
            where: { id },
            data: {
                ...(dto.name !== undefined ? { name: dto.name } : {}),
                ...(dto.description !== undefined ? { description: dto.description } : {}),
                ...(dto.accountId !== undefined ? { account_id: dto.accountId || null } : {}),
            },
            include: { account: { select: { id: true, name: true, code: true } } },
        });
    }

    async deleteCategory(tenantId: string, id: string) {
        const category = await this.db.expenseCategory.findFirst({
            where: { id, tenant_id: tenantId },
            include: { _count: { select: { entries: true, heads: true } } },
        });
        if (!category) {
            throw new NotFoundException('Expense category not found.');
        }
        if (category._count.heads > 0) {
            throw new BadRequestException(
                'Cannot delete this category — remove its expense heads first.',
            );
        }
        if (category._count.entries > 0) {
            throw new BadRequestException(
                'Cannot delete this category — it has associated expense entries.',
            );
        }

        return this.db.expenseCategory.delete({ where: { id } });
    }

    async listHeads(tenantId: string, categoryId?: string) {
        if (categoryId) {
            await this.assertCategoryExists(tenantId, categoryId);
        }
        return this.db.expenseHead.findMany({
            where: {
                tenant_id: tenantId,
                ...(categoryId ? { category_id: categoryId } : {}),
            },
            include: {
                category: { select: { id: true, name: true, account_id: true } },
                account: { select: { id: true, name: true, code: true } },
                _count: { select: { entries: true } },
            },
            orderBy: [{ category: { name: 'asc' } }, { name: 'asc' }],
        });
    }

    async createHead(tenantId: string, dto: CreateExpenseHeadDto) {
        await this.assertCategoryExists(tenantId, dto.categoryId);
        const name = this.cleanHeadName(dto.name);
        await this.assertHeadNameAvailable(tenantId, dto.categoryId, name);
        if (dto.accountId) {
            await this.assertExpenseAccount(tenantId, dto.accountId);
        }

        return this.db.expenseHead.create({
            data: {
                tenant_id: tenantId,
                category_id: dto.categoryId,
                name,
                description: this.cleanDescription(dto.description),
                account_id: dto.accountId || null,
            },
            include: this.headInclude(),
        });
    }

    async updateHead(tenantId: string, id: string, dto: UpdateExpenseHeadDto) {
        const head = await this.assertHeadExists(tenantId, id);
        const name = dto.name !== undefined ? this.cleanHeadName(dto.name) : undefined;
        if (name && name !== head.name) {
            await this.assertHeadNameAvailable(tenantId, head.category_id, name, id);
        }
        if (dto.accountId) {
            await this.assertExpenseAccount(tenantId, dto.accountId);
        }

        return this.db.expenseHead.update({
            where: { id },
            data: {
                ...(name !== undefined ? { name } : {}),
                ...(dto.description !== undefined ? { description: this.cleanDescription(dto.description) } : {}),
                ...(dto.accountId !== undefined ? { account_id: dto.accountId || null } : {}),
            },
            include: this.headInclude(),
        });
    }

    async deleteHead(tenantId: string, id: string) {
        const head = await this.db.expenseHead.findFirst({
            where: { id, tenant_id: tenantId },
            include: { _count: { select: { entries: true } } },
        });
        if (!head) {
            throw new NotFoundException('Expense head not found.');
        }
        if (head._count.entries > 0) {
            throw new BadRequestException(
                'Cannot delete this expense head — it has expense entries.',
            );
        }

        return this.db.expenseHead.delete({ where: { id } });
    }

    async listEntries(
        tenantId: string,
        query: ListExpenseEntriesQueryDto & { timezone: string },
    ): Promise<PaginatedResult<any>> {
        const page = query.page ?? 1;
        const limit = Math.min(query.limit ?? 20, 100);
        const skip = (page - 1) * limit;
        const where = this.buildEntryWhere(tenantId, query);

        const [items, total] = await Promise.all([
            this.db.expenseEntry.findMany({
                where,
                include: this.entryInclude(),
                orderBy: [{ expense_date: 'desc' }, { created_at: 'desc' }],
                skip,
                take: limit,
            }),
            this.db.expenseEntry.count({ where }),
        ]);

        return paginate(items, total, page, limit);
    }

    async createEntry(tenantId: string, userId: string, dto: CreateExpenseEntryDto) {
        const head = await this.assertHeadExists(tenantId, dto.headId);
        if (dto.storeId) {
            await this.assertStoreExists(tenantId, dto.storeId);
        }

        const paymentMethod = dto.paymentMethod ?? 'CASH';
        const paymentMode = paymentMethod.toLowerCase().includes('bank')
            || paymentMethod.toLowerCase().includes('bkash')
            || paymentMethod.toLowerCase().includes('nagad')
            || paymentMethod.toLowerCase().includes('transfer')
            ? 'bank'
            : 'cash';

        return this.db.$transaction(async (tx) => {
            const entry = await tx.expenseEntry.create({
                data: {
                    tenant_id: tenantId,
                    category_id: head.category_id,
                    head_id: head.id,
                    store_id: dto.storeId,
                    amount: dto.amount,
                    expense_date: new Date(dto.expenseDate),
                    description: dto.description,
                    payment_method: paymentMethod,
                    created_by: userId,
                },
                include: this.entryInclude(),
            });

            const posting = await autoPostFromRules({
                tx,
                tenantId,
                eventType: 'expense',
                conditionKey: 'payment_mode',
                conditionValue: paymentMode,
                sourceModule: 'expenses',
                sourceType: 'expense_entry',
                sourceId: entry.id,
                amount: Number(entry.amount),
                description: `Auto-posted expense${entry.description ? `: ${entry.description}` : ''}`,
                date: entry.expense_date,
                storeId: entry.store_id ?? undefined,
                // The rule debits General Operating Expense. A head with its own
                // account charges that. Otherwise the category's account is
                // used. Cash or bank still comes from the rule.
                ...((head.account_id ?? head.category.account_id)
                    ? { overrideDebitAccountId: head.account_id ?? head.category.account_id }
                    : {}),
            });

            return {
                ...entry,
                posting_status: posting.postingStatus,
                voucher_id: posting.voucherId ?? null,
                voucher_number: posting.voucherNumber ?? null,
                voucher_type: posting.voucherType ?? null,
            };
        });
    }

    async updateEntry(tenantId: string, id: string, dto: UpdateExpenseEntryDto) {
        await this.assertEntryExists(tenantId, id);

        let head: { id: string; category_id: string } | undefined;
        if (dto.headId) {
            head = await this.assertHeadExists(tenantId, dto.headId);
        }
        if (dto.storeId) {
            await this.assertStoreExists(tenantId, dto.storeId);
        }

        return this.db.expenseEntry.update({
            where: { id },
            data: {
                ...(head ? { head_id: head.id, category_id: head.category_id } : {}),
                ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
                ...(dto.expenseDate !== undefined ? { expense_date: new Date(dto.expenseDate) } : {}),
                ...(dto.storeId !== undefined ? { store_id: dto.storeId } : {}),
                ...(dto.description !== undefined ? { description: dto.description } : {}),
                ...(dto.paymentMethod !== undefined ? { payment_method: dto.paymentMethod } : {}),
            },
            include: this.entryInclude(),
        });
    }

    async deleteEntry(tenantId: string, id: string) {
        await this.assertEntryExists(tenantId, id);
        return this.db.expenseEntry.delete({ where: { id } });
    }

    async getSummary(tenantId: string, query: ExpenseReportQueryDto) {
        const expenseWhere = this.buildExpenseDateWhere(tenantId, query.from, query.to, query.storeId);
        const saleWhere = this.buildSaleDateWhere(tenantId, query.from, query.to, query.storeId);

        const [entries, revenueAggregate] = await Promise.all([
            this.db.expenseEntry.findMany({
                where: expenseWhere,
                include: {
                    category: { select: { id: true, name: true } },
                    head: { select: { id: true, name: true } },
                },
                orderBy: { expense_date: 'asc' },
            }),
            this.db.sale.aggregate({
                where: saleWhere,
                _sum: { total_amount: true },
            }),
        ]);

        const total = entries.reduce((sum, entry) => sum + Number(entry.amount), 0);
        const revenue = Number(revenueAggregate._sum.total_amount ?? 0);

        const categoryMap = new Map<
            string,
            {
                categoryId: string;
                name: string;
                amount: number;
                heads: Map<string, { headId: string; name: string; amount: number }>;
            }
        >();

        for (const entry of entries) {
            const existing = categoryMap.get(entry.category_id) ?? {
                categoryId: entry.category.id,
                name: entry.category.name,
                amount: 0,
                heads: new Map(),
            };
            const amount = Number(entry.amount);
            existing.amount += amount;
            // An entry written before the backfill still belongs under its
            // category, labelled with that category's name.
            const headId = entry.head_id ?? entry.category_id;
            const head = existing.heads.get(headId) ?? {
                headId,
                name: entry.head?.name ?? entry.category.name,
                amount: 0,
            };
            head.amount += amount;
            existing.heads.set(headId, head);
            categoryMap.set(entry.category_id, existing);
        }

        const byCategory = Array.from(categoryMap.values())
            .sort((a, b) => b.amount - a.amount)
            .map((row) => ({
                categoryId: row.categoryId,
                name: row.name,
                amount: row.amount,
                sharePct: total > 0 ? (row.amount / total) * 100 : 0,
                heads: Array.from(row.heads.values())
                    .sort((a, b) => b.amount - a.amount)
                    .map((head) => ({
                        ...head,
                        sharePct: row.amount > 0 ? (head.amount / row.amount) * 100 : 0,
                    })),
            }));

        const monthMap = new Map<string, number>();
        const dayMap = new Map<string, number>();
        for (const entry of entries) {
            const amount = Number(entry.amount);
            const iso = entry.expense_date.toISOString();
            const month = iso.slice(0, 7);
            const day = iso.slice(0, 10);
            monthMap.set(month, (monthMap.get(month) ?? 0) + amount);
            dayMap.set(day, (dayMap.get(day) ?? 0) + amount);
        }

        const monthlyTrend = Array.from(monthMap.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([month, amount]) => ({ month, amount }));

        const dailyTrend = Array.from(dayMap.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, amount]) => ({ date, amount }));

        return {
            total,
            byCategory,
            monthlyTrend,
            dailyTrend,
            expenseToRevenueRatio: revenue > 0 ? total / revenue : 0,
        };
    }

    private entryInclude() {
        return {
            category: true,
            head: true,
            store: { select: { id: true, name: true } },
        };
    }

    private buildEntryWhere(tenantId: string, query: ListExpenseEntriesQueryDto & { timezone: string }) {
        const where: Record<string, any> = { tenant_id: tenantId };
        if (query.categoryId) where.category_id = query.categoryId;
        if (query.headId) where.head_id = query.headId;
        if (query.storeId) where.store_id = query.storeId;

        const dateFilter = this.buildDateRangeFilter(query.from, query.to);
        if (dateFilter) {
            where.expense_date = dateFilter;
        }

        const created = createdAtRange(query.createdFrom, query.createdTo, query.timezone);
        if (created) where.created_at = created;

        return where;
    }

    private buildExpenseDateWhere(
        tenantId: string,
        from?: string,
        to?: string,
        storeId?: string,
    ) {
        const where: Record<string, any> = { tenant_id: tenantId };
        if (storeId) where.store_id = storeId;

        const dateFilter = this.buildDateRangeFilter(from, to);
        if (dateFilter) {
            where.expense_date = dateFilter;
        }

        return where;
    }

    private buildSaleDateWhere(tenantId: string, from?: string, to?: string, storeId?: string) {
        const where: Record<string, any> = { tenant_id: tenantId };
        if (storeId) where.store_id = storeId;

        if (from || to) {
            where.sale_date = {};
            if (from) {
                const date = new Date(from);
                if (!Number.isNaN(date.getTime())) where.sale_date.gte = date;
            }
            if (to) {
                const date = new Date(to);
                if (!Number.isNaN(date.getTime())) where.sale_date.lte = date;
            }
        }

        return where;
    }

    private buildDateRangeFilter(from?: string, to?: string) {
        if (!from && !to) return undefined;

        const filter: Record<string, Date> = {};
        if (from) {
            const date = new Date(from);
            if (!Number.isNaN(date.getTime())) filter.gte = date;
        }
        if (to) {
            const date = new Date(to);
            if (!Number.isNaN(date.getTime())) filter.lte = date;
        }

        return Object.keys(filter).length > 0 ? filter : undefined;
    }

    private cleanHeadName(name: string) {
        const trimmed = name.trim();
        if (!trimmed) {
            throw new BadRequestException('Expense head name is required.');
        }
        return trimmed;
    }

    private cleanDescription(description?: string) {
        const trimmed = description?.trim();
        return trimmed ? trimmed : null;
    }

    private async assertHeadNameAvailable(
        tenantId: string,
        categoryId: string,
        name: string,
        exceptId?: string,
    ) {
        const duplicate = await this.db.expenseHead.findFirst({
            where: {
                tenant_id: tenantId,
                category_id: categoryId,
                name,
                ...(exceptId ? { NOT: { id: exceptId } } : {}),
            },
        });
        if (duplicate) {
            throw new BadRequestException('An expense head with this name already exists in this category.');
        }
    }

    private headInclude() {
        return {
            category: { select: { id: true, name: true, account_id: true } },
            account: { select: { id: true, name: true, code: true } },
            _count: { select: { entries: true } },
        };
    }

    private async assertHeadExists(tenantId: string, id: string) {
        const head = await this.db.expenseHead.findFirst({
            where: { id, tenant_id: tenantId },
            include: { category: { select: { account_id: true } } },
        });
        if (!head) {
            throw new NotFoundException('Expense head not found.');
        }
        return head;
    }

    private async assertExpenseAccount(tenantId: string, accountId: string) {
        const account = await this.db.account.findFirst({
            where: { id: accountId, tenant_id: tenantId },
        });
        if (!account) {
            throw new NotFoundException('Account not found.');
        }
        if (account.type !== 'expense') {
            throw new BadRequestException('Choose an expense account.');
        }
        return account;
    }

    private async assertCategoryExists(tenantId: string, id: string) {
        const category = await this.db.expenseCategory.findFirst({
            where: { id, tenant_id: tenantId },
        });
        if (!category) {
            throw new NotFoundException('Expense category not found.');
        }
        return category;
    }

    private async assertEntryExists(tenantId: string, id: string) {
        const entry = await this.db.expenseEntry.findFirst({
            where: { id, tenant_id: tenantId },
        });
        if (!entry) {
            throw new NotFoundException('Expense entry not found.');
        }
        return entry;
    }

    private async assertStoreExists(tenantId: string, storeId: string) {
        const store = await this.db.store.findFirst({
            where: { id: storeId, tenant_id: tenantId },
        });
        if (!store) {
            throw new NotFoundException('Store not found.');
        }
        return store;
    }
}