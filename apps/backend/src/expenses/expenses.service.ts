import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { paginate, PaginatedResult } from '../common/pagination.dto';
import { autoPostFromRules } from '../accounting/posting.utils';
import {
    CreateExpenseCategoryDto,
    CreateExpenseEntryDto,
    ExpenseReportQueryDto,
    ListExpenseEntriesQueryDto,
    UpdateExpenseCategoryDto,
    UpdateExpenseEntryDto,
} from './expenses.dto';

@Injectable()
export class ExpensesService {
    constructor(private db: DatabaseService) {}

    async listCategories(tenantId: string) {
        return this.db.expenseCategory.findMany({
            where: { tenant_id: tenantId },
            include: { _count: { select: { entries: true } } },
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

        return this.db.expenseCategory.create({
            data: {
                tenant_id: tenantId,
                name: dto.name,
                description: dto.description,
            },
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

        return this.db.expenseCategory.update({
            where: { id },
            data: {
                ...(dto.name !== undefined ? { name: dto.name } : {}),
                ...(dto.description !== undefined ? { description: dto.description } : {}),
            },
        });
    }

    async deleteCategory(tenantId: string, id: string) {
        const category = await this.db.expenseCategory.findFirst({
            where: { id, tenant_id: tenantId },
            include: { _count: { select: { entries: true } } },
        });
        if (!category) {
            throw new NotFoundException('Expense category not found.');
        }
        if (category._count.entries > 0) {
            throw new BadRequestException(
                'Cannot delete this category — it has associated expense entries.',
            );
        }

        return this.db.expenseCategory.delete({ where: { id } });
    }

    async listEntries(
        tenantId: string,
        query: ListExpenseEntriesQueryDto,
    ): Promise<PaginatedResult<any>> {
        const page = query.page ?? 1;
        const limit = Math.min(query.limit ?? 20, 100);
        const skip = (page - 1) * limit;
        const where = this.buildEntryWhere(tenantId, query);

        const [items, total] = await Promise.all([
            this.db.expenseEntry.findMany({
                where,
                include: {
                    category: true,
                    store: { select: { id: true, name: true } },
                },
                orderBy: [{ expense_date: 'desc' }, { created_at: 'desc' }],
                skip,
                take: limit,
            }),
            this.db.expenseEntry.count({ where }),
        ]);

        return paginate(items, total, page, limit);
    }

    async createEntry(tenantId: string, userId: string, dto: CreateExpenseEntryDto) {
        await this.assertCategoryExists(tenantId, dto.categoryId);
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
                    category_id: dto.categoryId,
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

        if (dto.categoryId) {
            await this.assertCategoryExists(tenantId, dto.categoryId);
        }
        if (dto.storeId) {
            await this.assertStoreExists(tenantId, dto.storeId);
        }

        return this.db.expenseEntry.update({
            where: { id },
            data: {
                ...(dto.categoryId !== undefined ? { category_id: dto.categoryId } : {}),
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
                include: { category: { select: { id: true, name: true } } },
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
            { categoryId: string; name: string; amount: number }
        >();

        for (const entry of entries) {
            const existing = categoryMap.get(entry.category_id) ?? {
                categoryId: entry.category.id,
                name: entry.category.name,
                amount: 0,
            };
            existing.amount += Number(entry.amount);
            categoryMap.set(entry.category_id, existing);
        }

        const byCategory = Array.from(categoryMap.values())
            .sort((a, b) => b.amount - a.amount)
            .map((row) => ({
                ...row,
                sharePct: total > 0 ? (row.amount / total) * 100 : 0,
            }));

        const monthMap = new Map<string, number>();
        for (const entry of entries) {
            const month = entry.expense_date.toISOString().slice(0, 7);
            monthMap.set(month, (monthMap.get(month) ?? 0) + Number(entry.amount));
        }

        const monthlyTrend = Array.from(monthMap.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([month, amount]) => ({ month, amount }));

        return {
            total,
            byCategory,
            monthlyTrend,
            expenseToRevenueRatio: revenue > 0 ? total / revenue : 0,
        };
    }

    private entryInclude() {
        return {
            category: true,
            store: { select: { id: true, name: true } },
        };
    }

    private buildEntryWhere(tenantId: string, query: ListExpenseEntriesQueryDto) {
        const where: Record<string, any> = { tenant_id: tenantId };
        if (query.categoryId) where.category_id = query.categoryId;
        if (query.storeId) where.store_id = query.storeId;

        const dateFilter = this.buildDateRangeFilter(query.from, query.to);
        if (dateFilter) {
            where.expense_date = dateFilter;
        }

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
            where.created_at = {};
            if (from) {
                const date = new Date(from);
                if (!Number.isNaN(date.getTime())) where.created_at.gte = date;
            }
            if (to) {
                const date = new Date(to);
                if (!Number.isNaN(date.getTime())) where.created_at.lte = date;
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