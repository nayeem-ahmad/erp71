import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EncryptionService } from '../common/encryption.service';
import { autoPostFromRules, voidAutoPostedVoucher } from '../accounting/posting.utils';
import { resolveSettlementAccount } from '../accounting/payment-account.util';
import { buildPartyLedger } from '../accounting/party-ledger.util';
import { ageBalance, type AgingEntry } from '../accounting/aging.utils';
import {
    CreateCustomerDto,
    UpdateCustomerDto,
    RecordCreditPaymentDto,
    UpdateCreditPaymentDto,
    ListCustomerCreditPaymentsQueryDto,
    CustomerPaymentDirectionDto,
    WriteOffCustomerDebtDto,
    ListCustomerWriteOffsQueryDto,
} from './customer.dto';
import { paginate, PaginatedResult } from '../common/pagination.dto';
import { runImport, ImportResult } from '../common/import.util';
import { resolveOrderBy, SortableMap } from '../common/sort.util';
import { createdAtRange } from '../common/created-range.util';

const CUSTOMER_SORTABLE: SortableMap = {
    name: (dir) => ({ name: dir }),
    customer_code: (dir) => ({ customer_code: dir }),
    phone: (dir) => ({ phone: dir }),
    owner_name: (dir) => ({ owner_name: dir }),
    created_at: (dir) => ({ created_at: dir }),
    customerGroup: (dir) => ({ customerGroup: { name: dir } }),
    territory: (dir) => ({ territory: { name: dir } }),
    segment_category: (dir) => ({ segment_category: dir }),
    customer_type: (dir) => ({ customer_type: dir }),
    loyalty_points: (dir) => ({ loyalty_points: dir }),
};
const CUSTOMER_DEFAULT_ORDER = { created_at: 'desc' as const };

/**
 * Document-number prefixes per credit-transaction type. A write-off gets its own
 * series rather than sharing the payment one: "CWO-00004" on a customer's
 * statement has to be unmistakably not a receipt, because it is the row that
 * says money stopped being expected rather than that it arrived.
 */
const CREDIT_TRANSACTION_PREFIXES = {
    PAYMENT: 'CPY-',
    PAYOUT: 'CPO-',
    WRITE_OFF: 'CWO-',
} as const;

/** Amounts below this are rounding dust, not money. Matches customer-credit.utils. */
const AMOUNT_EPSILON = 0.005;

@Injectable()
export class CustomersService {
    constructor(
        private db: DatabaseService,
        private encryption: EncryptionService,
    ) {}

    private encryptNid(value: string | undefined | null): string | undefined {
        if (value == null) return undefined;
        return this.encryption.encrypt(value);
    }

    private decryptNid(value: string | undefined | null): string | undefined {
        if (value == null) return undefined;
        return this.encryption.decrypt(value);
    }

    private decryptCustomer<T extends { nid?: string | null }>(customer: T): T {
        return { ...customer, nid: this.decryptNid(customer.nid) };
    }

    /**
     * Next code in the auto-generated `CUST-#####` series. Scoped to that prefix so
     * hand-entered codes (`SHOP-12`, `A/114`) sit alongside the series without
     * derailing it.
     */
    private async generateCustomerCode(tenantId: string): Promise<string> {
        const last = await this.db.customer.findFirst({
            where: { tenant_id: tenantId, customer_code: { startsWith: 'CUST-' } },
            orderBy: { customer_code: 'desc' },
            select: { customer_code: true },
        });

        if (!last) return 'CUST-00001';

        const match = last.customer_code.match(/CUST-(\d+)/);
        const nextNum = match ? parseInt(match[1], 10) + 1 : 1;
        return `CUST-${String(nextNum).padStart(5, '0')}`;
    }

    private isCustomerCodeConflict(err: any): boolean {
        const target = err?.meta?.target;
        const fields = Array.isArray(target) ? target : [target];
        return err?.code === 'P2002' && fields.includes('customer_code');
    }

    /**
     * Runs `create` with a customer code. An explicit code is used as-is (and must
     * be free); otherwise the next generated code is tried, retrying on the unique
     * collision that concurrent creates can produce.
     */
    private async withCustomerCode<T>(
        tenantId: string,
        explicitCode: string | null | undefined,
        create: (customerCode: string) => Promise<T>,
    ): Promise<T> {
        const code = explicitCode?.trim();
        if (code) {
            const taken = await this.db.customer.findUnique({
                where: { tenant_id_customer_code: { tenant_id: tenantId, customer_code: code } },
                select: { id: true },
            });
            if (taken) {
                throw new BadRequestException(`Customer code "${code}" is already in use.`);
            }
            return create(code);
        }

        for (let attempt = 0; attempt < 5; attempt++) {
            try {
                return await create(await this.generateCustomerCode(tenantId));
            } catch (err: any) {
                if (!this.isCustomerCodeConflict(err)) throw err;
            }
        }
        throw new BadRequestException('Could not allocate a unique customer code. Please try again.');
    }

    private dueDelta(type: 'PAYMENT' | 'PAYOUT', amount: number): number {
        return type === 'PAYOUT' ? amount : -amount;
    }

    private ledgerDueDelta(type: string, amount: number): number {
        switch (type) {
            case 'CREDIT_SALE':
            case 'PAYOUT':
                return amount;
            case 'PAYMENT':
            // A write-off settles the due the same way a payment does; what
            // differs is where the other leg lands (expense, not cash).
            case 'WRITE_OFF':
                return -amount;
            case 'ADJUSTMENT':
                return amount;
            default:
                return 0;
        }
    }

    private directionFromType(type: string): CustomerPaymentDirectionDto {
        return type === 'PAYOUT' ? CustomerPaymentDirectionDto.PAY : CustomerPaymentDirectionDto.RECEIVE;
    }

    private typeFromDirection(direction: CustomerPaymentDirectionDto): 'PAYMENT' | 'PAYOUT' {
        return direction === CustomerPaymentDirectionDto.PAY ? 'PAYOUT' : 'PAYMENT';
    }

    private async enrichPaymentsWithVouchers(
        tenantId: string,
        items: any[],
        eventType: 'customer_payment' | 'bad_debt_write_off' = 'customer_payment',
    ) {
        if (items.length === 0) return items;

        const events = await this.db.postingEvent.findMany({
            where: {
                tenant_id: tenantId,
                source_module: 'customers',
                source_id: { in: items.map((item) => item.id) },
                event_type: eventType,
            },
            include: { voucher: { select: { id: true, voucher_number: true } } },
        });

        const voucherByPaymentId = new Map(
            events.map((event) => [event.source_id, event.voucher]),
        );

        return items.map((item) => {
            const voucher = voucherByPaymentId.get(item.id);
            return {
                ...item,
                voucher_id: voucher?.id ?? null,
                accounting_voucher_number: voucher?.voucher_number ?? null,
            };
        });
    }

    private async findCreditPaymentOrThrow(tenantId: string, paymentId: string) {
        const payment = await this.db.customerCreditTransaction.findFirst({
            where: {
                id: paymentId,
                tenant_id: tenantId,
                type: { in: ['PAYMENT', 'PAYOUT'] },
            },
            include: {
                customer: { select: { id: true, name: true, phone: true, customer_code: true, due_balance: true } },
                creator: { select: { id: true, name: true } },
            },
        });
        if (!payment) throw new NotFoundException('Customer payment not found');
        return payment;
    }

    /**
     * Where the chosen payment account goes on the voucher. The cash leg is the
     * debit when money comes in (Dr Cash / Cr AR) and the credit when it goes
     * out to the customer (Dr AR / Cr Cash); nothing chosen keeps the rule's.
     */
    private cashLegOverride(isPayout: boolean, accountId: string | undefined) {
        if (!accountId) return {};
        return isPayout ? { overrideCreditAccountId: accountId } : { overrideDebitAccountId: accountId };
    }

    private async generatePaymentNumber(
        tenantId: string,
        tx: any,
        txType: 'PAYMENT' | 'PAYOUT' | 'WRITE_OFF',
    ): Promise<string> {
        const prefix = CREDIT_TRANSACTION_PREFIXES[txType];
        const last = await tx.customerCreditTransaction.findFirst({
            where: {
                tenant_id: tenantId,
                type: txType,
                payment_number: { startsWith: prefix },
            },
            orderBy: { payment_number: 'desc' },
            select: { payment_number: true },
        });

        if (!last?.payment_number) return `${prefix}00001`;

        const match = last.payment_number.match(new RegExp(`${prefix.replace('-', '\\-')}(\\d+)`));
        const nextNum = match ? parseInt(match[1], 10) + 1 : 1;
        return `${prefix}${String(nextNum).padStart(5, '0')}`;
    }

    async create(tenantId: string, dto: CreateCustomerDto) {
        if (dto.phone) {
            const existing = await this.db.customer.findUnique({
                where: {
                    tenant_id_phone: {
                        tenant_id: tenantId,
                        phone: dto.phone,
                    }
                }
            });

            if (existing) {
                throw new BadRequestException('A customer with this phone number already exists.');
            }
        }

        const { nid, customer_code: requestedCode, ...rest } = dto;
        const record = await this.withCustomerCode(tenantId, requestedCode, (customer_code) =>
            this.db.customer.create({
                data: {
                    tenant_id: tenantId,
                    customer_code,
                    ...rest,
                    ...(nid != null ? { nid: this.encryptNid(nid) } : {}),
                },
                include: {
                    customerGroup: true,
                    territory: true,
                }
            }),
        );
        return this.decryptCustomer(record);
    }

    async findAll(
        tenantId: string,
        opts?: {
            page?: number;
            limit?: number;
            search?: string;
            segment?: string;
            customerType?: string;
            sortBy?: string;
            sortDir?: string;
            createdFrom?: string;
            createdTo?: string;
            /** IANA zone the calendar-day bounds above are measured in. */
            timezone: string;
        },
    ): Promise<PaginatedResult<any>> {
        const page = opts?.page ?? 1;
        const limit = Math.min(opts?.limit ?? 20, 100);
        const skip = (page - 1) * limit;

        const where: any = { tenant_id: tenantId, deleted_at: null };
        const created = createdAtRange(opts?.createdFrom, opts?.createdTo, opts?.timezone);
        if (created) where.created_at = created;
        if (opts?.search) {
            where.OR = [
                { name: { contains: opts.search, mode: 'insensitive' } },
                { owner_name: { contains: opts.search, mode: 'insensitive' } },
                { phone: { contains: opts.search } },
                { customer_code: { contains: opts.search, mode: 'insensitive' } },
            ];
        }
        if (opts?.segment) where.segment_category = opts.segment;
        if (opts?.customerType) where.customer_type = opts.customerType;

        const [items, total] = await Promise.all([
            this.db.customer.findMany({
                where,
                include: { customerGroup: true, territory: true },
                orderBy: resolveOrderBy(opts?.sortBy, opts?.sortDir, CUSTOMER_SORTABLE, CUSTOMER_DEFAULT_ORDER),
                skip,
                take: limit,
            }),
            this.db.customer.count({ where }),
        ]);

        return paginate(items.map(c => this.decryptCustomer(c)), total, page, limit);
    }

    async findOne(tenantId: string, id: string) {
        const customer = await this.db.customer.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
            include: {
                customerGroup: true,
                territory: true,
                sales: {
                    include: { items: { include: { product: true } } },
                    orderBy: { sale_date: 'desc' }
                }
            }
        });

        if (!customer) throw new NotFoundException('Customer not found');
        return this.decryptCustomer(customer);
    }

    async getPurchaseHistory(
        tenantId: string,
        id: string,
        params?: { page?: number; limit?: number; from?: string; to?: string },
    ) {
        const customer = await this.db.customer.findFirst({
            where: { id, tenant_id: tenantId },
            select: { id: true },
        });
        if (!customer) throw new NotFoundException('Customer not found');

        const page = params?.page ?? 1;
        const limit = Math.min(params?.limit ?? 20, 100);
        const skip = (page - 1) * limit;

        const where: any = { customer_id: id };
        if (params?.from || params?.to) {
            where.sale_date = {};
            if (params?.from) where.sale_date.gte = new Date(params.from);
            if (params?.to) where.sale_date.lte = new Date(params.to);
        }

        const [total, sales] = await Promise.all([
            this.db.sale.count({ where }),
            this.db.sale.findMany({
                where,
                orderBy: { sale_date: 'desc' },
                skip,
                take: limit,
                include: {
                    items: {
                        include: { product: { select: { id: true, name: true } } },
                    },
                    payments: { select: { payment_method: true, amount: true } },
                },
            }),
        ]);

        return {
            data: sales,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        };
    }

    async getSegmentStats(tenantId: string) {
        const customers = await this.db.customer.findMany({
            where: { tenant_id: tenantId },
            select: { segment_category: true },
        });

        const counts: Record<string, number> = {};
        for (const c of customers) {
            const seg = c.segment_category || 'Regular';
            counts[seg] = (counts[seg] || 0) + 1;
        }

        const total = customers.length;
        return {
            total,
            breakdown: Object.entries(counts).map(([segment, count]) => ({
                segment,
                count,
                percentage: total > 0 ? Math.round((count / total) * 100) : 0,
            })),
        };
    }

    async update(tenantId: string, id: string, dto: UpdateCustomerDto) {
        const customer = await this.db.customer.findFirst({
            where: { id, tenant_id: tenantId },
        });

        if (!customer) throw new NotFoundException('Customer not found');

        if (dto.phone && dto.phone !== customer.phone) {
            const duplicate = await this.db.customer.findUnique({
                where: {
                    tenant_id_phone: {
                        tenant_id: tenantId,
                        phone: dto.phone,
                    }
                }
            });
            if (duplicate) {
                throw new BadRequestException('A customer with this phone number already exists.');
            }
        }

        if (dto.customer_code && dto.customer_code.trim() !== customer.customer_code) {
            const duplicate = await this.db.customer.findUnique({
                where: {
                    tenant_id_customer_code: {
                        tenant_id: tenantId,
                        customer_code: dto.customer_code.trim(),
                    }
                },
                select: { id: true },
            });
            if (duplicate) {
                throw new BadRequestException(`Customer code "${dto.customer_code.trim()}" is already in use.`);
            }
        }

        const { nid, ...rest } = dto;
        if (rest.customer_code) rest.customer_code = rest.customer_code.trim();
        const record = await this.db.customer.update({
            where: { id },
            data: {
                ...rest,
                ...(nid != null ? { nid: this.encryptNid(nid) } : {}),
            },
            include: {
                customerGroup: true,
                territory: true,
            }
        });
        return this.decryptCustomer(record);
    }

    async getAnalytics(tenantId: string, id: string) {
        const customer = await this.db.customer.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
            select: {
                id: true, name: true, total_spent: true, created_at: true,
                segment_category: true, loyalty_points: true, due_balance: true,
            },
        });
        if (!customer) throw new NotFoundException('Customer not found');

        const [salesCount, lastSale] = await Promise.all([
            this.db.sale.count({ where: { customer_id: id } }),
            this.db.sale.findFirst({
                where: { customer_id: id },
                orderBy: { sale_date: 'desc' },
                select: { sale_date: true, total_amount: true },
            }),
        ]);

        const totalSpent = Number(customer.total_spent);
        const avgOrderValue = salesCount > 0 ? totalSpent / salesCount : 0;
        const daysSinceLastPurchase = lastSale
            ? Math.floor((Date.now() - lastSale.sale_date.getTime()) / 86_400_000)
            : null;

        return {
            customer_id: id,
            total_spent: totalSpent,
            order_count: salesCount,
            avg_order_value: avgOrderValue,
            last_purchase_date: lastSale?.sale_date ?? null,
            days_since_last_purchase: daysSinceLastPurchase,
            loyalty_points: customer.loyalty_points,
            due_balance: Number(customer.due_balance),
            segment: customer.segment_category,
        };
    }

    /**
     * The customer ledger derived from the GENERAL LEDGER — the AR voucher lines
     * tagged to this customer — rather than from CustomerCreditTransaction. Same
     * shape as getCreditLedger so the UI can swap to it; the two are kept side by
     * side so they can be diffed before the parallel table is retired.
     */
    async getGlLedger(
        tenantId: string,
        id: string,
        params?: { from?: string; to?: string },
    ) {
        const customer = await this.db.customer.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
            select: { id: true, name: true, phone: true, due_balance: true, credit_limit: true, credit_enabled: true },
        });
        if (!customer) throw new NotFoundException('Customer not found');

        const ledger = await buildPartyLedger(this.db, tenantId, 'CUSTOMER', id, {
            from: params?.from,
            to: params?.to,
            increaseLabel: 'CREDIT_SALE',
            decreaseLabel: 'PAYMENT',
        });

        return {
            customer: { id: customer.id, name: customer.name, phone: customer.phone },
            due_balance: Number(customer.due_balance),
            opening_balance: ledger.opening_balance,
            closing_balance: ledger.closing_balance,
            credit_limit: customer.credit_limit ? Number(customer.credit_limit) : null,
            credit_enabled: customer.credit_enabled,
            transactions: ledger.transactions,
            total: ledger.total,
            source: 'general_ledger' as const,
        };
    }

    async getCreditLedger(
        tenantId: string,
        id: string,
        params?: { page?: number; limit?: number; from?: string; to?: string },
    ) {
        const customer = await this.db.customer.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
            select: { id: true, name: true, phone: true, due_balance: true, credit_limit: true, credit_enabled: true },
        });
        if (!customer) throw new NotFoundException('Customer not found');

        const page = params?.page ?? 1;
        const limit = Math.min(params?.limit ?? 100, 500);
        const skip = (page - 1) * limit;

        const where: any = { customer_id: id, tenant_id: tenantId };
        let periodStart: Date | null = null;

        if (params?.from || params?.to) {
            where.created_at = {};
            if (params.from) {
                periodStart = new Date(params.from);
                periodStart.setUTCHours(0, 0, 0, 0);
                where.created_at.gte = periodStart;
            }
            if (params.to) {
                const to = new Date(params.to);
                to.setUTCHours(23, 59, 59, 999);
                where.created_at.lte = to;
            }
        }

        let opening_balance = 0;
        if (periodStart) {
            const priorTx = await this.db.customerCreditTransaction.findFirst({
                where: {
                    customer_id: id,
                    tenant_id: tenantId,
                    created_at: { lt: periodStart },
                },
                orderBy: { created_at: 'desc' },
                select: { balance_after: true },
            });
            opening_balance = priorTx ? Number(priorTx.balance_after) : 0;
        }

        const [total, transactions, writtenOff] = await Promise.all([
            this.db.customerCreditTransaction.count({ where }),
            this.db.customerCreditTransaction.findMany({
                where,
                orderBy: { created_at: 'asc' },
                skip,
                take: limit,
                include: { creator: { select: { id: true, name: true } } },
            }),
            // Lifetime, not windowed: "we have forgiven ৳12,000 of this
            // customer's debt" is the number that should decide whether to sell
            // to them on credit again, and a date filter on the ledger below
            // must not quietly change it. Derived rather than denormalized onto
            // Customer so it cannot drift from the rows it sums.
            this.db.customerCreditTransaction.aggregate({
                where: { tenant_id: tenantId, customer_id: id, type: 'WRITE_OFF' },
                _sum: { amount: true },
            }),
        ]);

        const items = transactions.map((tx) => {
            const amount = Number(tx.amount);
            const balanceAfter = Number(tx.balance_after);
            return {
                ...tx,
                amount,
                balance_after: balanceAfter,
                balance_before: balanceAfter - this.ledgerDueDelta(tx.type, amount),
            };
        });

        const closing_balance = items.length > 0
            ? Number(items[items.length - 1].balance_after)
            : opening_balance;

        const pages = Math.ceil(total / limit);
        return {
            customer: { id: customer.id, name: customer.name, phone: customer.phone },
            due_balance: Number(customer.due_balance),
            written_off_total: Number(writtenOff._sum.amount ?? 0),
            opening_balance,
            closing_balance,
            credit_limit: customer.credit_limit ? Number(customer.credit_limit) : null,
            credit_enabled: customer.credit_enabled,
            transactions: items,
            total,
            page,
            limit,
            pages,
        };
    }

    async listCreditPayments(
        tenantId: string,
        query: ListCustomerCreditPaymentsQueryDto & { timezone: string },
    ): Promise<PaginatedResult<any>> {
        const page = query.page ?? 1;
        const limit = Math.min(query.limit ?? 20, 100);
        const skip = (page - 1) * limit;

        const where: any = {
            tenant_id: tenantId,
            type: { in: ['PAYMENT', 'PAYOUT'] },
        };

        if (query.customerId) {
            where.customer_id = query.customerId;
        }

        const created = createdAtRange(query.from, query.to, query.timezone);
        if (created) where.created_at = created;

        if (query.search) {
            where.OR = [
                { payment_number: { contains: query.search, mode: 'insensitive' } },
                { notes: { contains: query.search, mode: 'insensitive' } },
                { customer: { name: { contains: query.search, mode: 'insensitive' } } },
                { customer: { phone: { contains: query.search } } },
            ];
        }

        const [items, total] = await Promise.all([
            this.db.customerCreditTransaction.findMany({
                where,
                include: {
                    customer: { select: { id: true, name: true, phone: true, customer_code: true } },
                    creator: { select: { id: true, name: true } },
                },
                orderBy: { created_at: 'desc' },
                skip,
                take: limit,
            }),
            this.db.customerCreditTransaction.count({ where }),
        ]);

        const enriched = await this.enrichPaymentsWithVouchers(tenantId, items);
        return paginate(enriched, total, page, limit);
    }

    async getCreditPayment(tenantId: string, paymentId: string) {
        const payment = await this.findCreditPaymentOrThrow(tenantId, paymentId);
        const [enriched] = await this.enrichPaymentsWithVouchers(tenantId, [payment]);
        return enriched;
    }

    async updateCreditPayment(tenantId: string, paymentId: string, dto: UpdateCreditPaymentDto, storeId?: string) {
        const payment = await this.findCreditPaymentOrThrow(tenantId, paymentId);
        const oldType = payment.type as 'PAYMENT' | 'PAYOUT';
        const oldAmount = Number(payment.amount);
        const customerId = payment.customer_id;

        const newDirection = dto.direction ?? this.directionFromType(oldType);
        const newType = this.typeFromDirection(newDirection);
        const newAmount = dto.amount ?? oldAmount;
        const newNotes = dto.notes !== undefined ? dto.notes : payment.notes;

        if (newAmount <= 0) throw new BadRequestException('Amount must be positive');

        return this.db.$transaction(async (tx) => {
            // A method left out of the edit keeps the one recorded, so an edit
            // to the amount alone does not quietly move the money back to cash.
            const settlement = dto.paymentMethod !== undefined || dto.accountId !== undefined
                ? await resolveSettlementAccount(tx, tenantId, dto)
                : { paymentMethod: payment.payment_method, accountId: payment.account_id ?? undefined };

            const customer = await tx.customer.findFirst({
                where: { id: customerId, tenant_id: tenantId, deleted_at: null },
                select: { id: true, name: true, due_balance: true },
            });
            if (!customer) throw new NotFoundException('Customer not found');

            const reverseDelta = -this.dueDelta(oldType, oldAmount);
            let currentDue = Number(customer.due_balance) + reverseDelta;

            await voidAutoPostedVoucher(tx, tenantId, 'customer_payment', paymentId);

            const balanceAfter = currentDue + this.dueDelta(newType, newAmount);
            const isPayout = newType === 'PAYOUT';

            const updated = await tx.customerCreditTransaction.update({
                where: { id: paymentId },
                data: {
                    type: newType,
                    amount: newAmount,
                    balance_after: balanceAfter,
                    notes: newNotes,
                    payment_method: settlement.paymentMethod,
                    account_id: settlement.accountId ?? null,
                },
                include: {
                    customer: { select: { id: true, name: true, phone: true, customer_code: true } },
                    creator: { select: { id: true, name: true } },
                },
            });

            await tx.customer.update({
                where: { id: customerId },
                data: { due_balance: balanceAfter },
            });

            const posting = await autoPostFromRules({
                tx,
                tenantId,
                eventType: 'customer_payment',
                conditionKey: 'payment_direction',
                conditionValue: newDirection,
                sourceModule: 'customers',
                sourceType: isPayout ? 'customer_payout' : 'customer_payment',
                sourceId: paymentId,
                amount: newAmount,
                description: isPayout
                    ? `Customer payout — ${customer.name}`
                    : `Customer payment — ${customer.name}`,
                referenceNumber: payment.payment_number ?? paymentId,
                storeId,
                partyType: 'CUSTOMER',
                partyId: customerId,
                ...this.cashLegOverride(isPayout, settlement.accountId),
            });

            return {
                ...updated,
                posting_status: posting.postingStatus,
                voucher_id: posting.voucherId ?? null,
                accounting_voucher_number: posting.voucherNumber ?? null,
            };
        });
    }

    async deleteCreditPayment(tenantId: string, paymentId: string) {
        const payment = await this.findCreditPaymentOrThrow(tenantId, paymentId);
        const oldType = payment.type as 'PAYMENT' | 'PAYOUT';
        const oldAmount = Number(payment.amount);

        return this.db.$transaction(async (tx) => {
            const customer = await tx.customer.findFirst({
                where: { id: payment.customer_id, tenant_id: tenantId },
                select: { id: true, due_balance: true },
            });
            if (!customer) throw new NotFoundException('Customer not found');

            const reverseDelta = -this.dueDelta(oldType, oldAmount);
            const newDue = Number(customer.due_balance) + reverseDelta;

            await voidAutoPostedVoucher(tx, tenantId, 'customer_payment', paymentId);

            await tx.customerCreditTransaction.delete({ where: { id: paymentId } });

            await tx.customer.update({
                where: { id: payment.customer_id },
                data: { due_balance: newDue },
            });

            return { deleted: true, id: paymentId };
        });
    }

    async recordCreditPayment(
        tenantId: string,
        id: string,
        userId: string,
        dto: RecordCreditPaymentDto,
        storeId?: string,
    ) {
        const customer = await this.db.customer.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
            select: { id: true, name: true, due_balance: true },
        });
        if (!customer) throw new NotFoundException('Customer not found');

        const direction = dto.direction ?? CustomerPaymentDirectionDto.RECEIVE;
        const isPayout = direction === CustomerPaymentDirectionDto.PAY;
        const txType = isPayout ? 'PAYOUT' : 'PAYMENT';

        if (dto.amount <= 0) throw new BadRequestException('Amount must be positive');

        const currentDue = Number(customer.due_balance);
        const balanceAfter = isPayout ? currentDue + dto.amount : currentDue - dto.amount;

        return this.db.$transaction(async (tx) => {
            const payment_number = await this.generatePaymentNumber(tenantId, tx, txType);
            const settlement = await resolveSettlementAccount(tx, tenantId, dto);

            const payment = await tx.customerCreditTransaction.create({
                data: {
                    tenant_id: tenantId,
                    customer_id: id,
                    type: txType,
                    amount: dto.amount,
                    balance_after: balanceAfter,
                    payment_number,
                    notes: dto.notes,
                    payment_method: settlement.paymentMethod,
                    account_id: settlement.accountId ?? null,
                    created_by: userId,
                },
                include: {
                    customer: { select: { id: true, name: true, phone: true, customer_code: true } },
                    creator: { select: { id: true, name: true } },
                },
            });

            await tx.customer.update({
                where: { id },
                data: { due_balance: balanceAfter },
            });

            const posting = await autoPostFromRules({
                tx,
                tenantId,
                eventType: 'customer_payment',
                conditionKey: 'payment_direction',
                conditionValue: direction,
                sourceModule: 'customers',
                sourceType: txType === 'PAYOUT' ? 'customer_payout' : 'customer_payment',
                sourceId: payment.id,
                amount: dto.amount,
                description: isPayout
                    ? `Customer payout — ${customer.name}`
                    : `Customer payment — ${customer.name}`,
                referenceNumber: payment_number,
                storeId,
                partyType: 'CUSTOMER',
                partyId: id,
                ...this.cashLegOverride(isPayout, settlement.accountId),
            });

            return {
                ...payment,
                posting_status: posting.postingStatus,
                voucher_id: posting.voucherId ?? null,
                voucher_number: posting.voucherNumber ?? null,
            };
        });
    }

    /**
     * Forgives a customer debt the shop has given up on collecting.
     *
     * Posts Dr Bad Debt Expense / Cr Accounts Receivable, tagged to the
     * customer, and settles the same amount on the parallel credit ledger in
     * the one transaction — AR is kept twice in this system, and a write-off
     * that moved only the GL would leave the customer showing a due forever
     * while `reconcile:balances` reported a diff that was not a bug.
     *
     * The sale's revenue is NOT reversed. The goods were delivered and the
     * invoice was real; what failed is collection, so the loss is an expense.
     * Reversing revenue instead would also restate a Mushak 6.3 that NBR
     * already holds a copy of.
     */
    async writeOffDebt(
        tenantId: string,
        id: string,
        userId: string,
        dto: WriteOffCustomerDebtDto,
        storeId?: string,
    ) {
        const customer = await this.db.customer.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
            select: { id: true, name: true, due_balance: true, credit_enabled: true },
        });
        if (!customer) throw new NotFoundException('Customer not found');

        if (dto.amount <= 0) throw new BadRequestException('Amount must be positive');

        const currentDue = Number(customer.due_balance);
        if (currentDue <= AMOUNT_EPSILON) {
            throw new BadRequestException(
                `${customer.name} owes nothing, so there is no debt to write off.`,
            );
        }
        // Writing off more than is owed would conjure a credit balance out of
        // nothing and overstate the expense. A partial write-off is ordinary —
        // a customer who settles part of a debt leaves the rest to forgive —
        // but it can never exceed what is on the ledger.
        if (dto.amount > currentDue + AMOUNT_EPSILON) {
            throw new BadRequestException(
                `Cannot write off ৳${dto.amount.toFixed(2)}: ${customer.name} owes `
                + `৳${currentDue.toFixed(2)}.`,
            );
        }

        const balanceAfter = currentDue - dto.amount;
        const writeOffDate = dto.date ? new Date(dto.date) : new Date();
        // Default ON: the write-off drops due_balance, and assertCustomerCreditForSale
        // gates credit sales on that figure — so doing nothing here would hand the
        // customer their whole credit limit back the moment they failed to pay it.
        const disableCredit = dto.disableCredit ?? true;

        return this.db.$transaction(async (tx) => {
            const payment_number = await this.generatePaymentNumber(tenantId, tx, 'WRITE_OFF');

            const writeOff = await tx.customerCreditTransaction.create({
                data: {
                    tenant_id: tenantId,
                    customer_id: id,
                    type: 'WRITE_OFF',
                    amount: dto.amount,
                    balance_after: balanceAfter,
                    payment_number,
                    reference_type: 'BAD_DEBT',
                    reference_id: dto.reason,
                    notes: dto.notes,
                    created_by: userId,
                    created_at: writeOffDate,
                },
                include: {
                    customer: { select: { id: true, name: true, phone: true, customer_code: true } },
                    creator: { select: { id: true, name: true } },
                },
            });

            await tx.customer.update({
                where: { id },
                data: {
                    due_balance: balanceAfter,
                    ...(disableCredit ? { credit_enabled: false } : {}),
                },
            });

            const posting = await autoPostFromRules({
                tx,
                tenantId,
                eventType: 'bad_debt_write_off',
                conditionKey: 'none',
                sourceModule: 'customers',
                sourceType: 'customer_write_off',
                sourceId: writeOff.id,
                amount: dto.amount,
                description: `Bad debt written off — ${customer.name}`,
                referenceNumber: payment_number,
                date: writeOffDate,
                storeId,
                partyType: 'CUSTOMER',
                partyId: id,
            });

            return {
                ...writeOff,
                reason: dto.reason,
                credit_disabled: disableCredit,
                posting_status: posting.postingStatus,
                voucher_id: posting.voucherId ?? null,
                voucher_number: posting.voucherNumber ?? null,
            };
        });
    }

    /**
     * Undoes a write-off, putting the debt back on the customer's ledger.
     *
     * Deletes the voucher rather than posting a contra entry, which is what
     * `deleteCreditPayment` does for a mistaken payment and what the fiscal
     * lock inside `voidAutoPostedVoucher` is written to guard: a closed period
     * refuses the reversal instead of silently reopening itself.
     *
     * This is also how a LATER RECOVERY is handled — reverse the write-off, then
     * record the payment normally — because a recovery cannot post as an
     * ordinary `customer_payment`: that rule credits Accounts Receivable, and
     * after a write-off there is no receivable left to credit. Note the expense
     * comes back out of the period the write-off was posted in, so a recovery
     * that crosses a fiscal year needs the period reopened or a manual journal.
     */
    async reverseWriteOff(tenantId: string, writeOffId: string) {
        const writeOff = await this.db.customerCreditTransaction.findFirst({
            where: { id: writeOffId, tenant_id: tenantId, type: 'WRITE_OFF' },
            select: { id: true, customer_id: true, amount: true },
        });
        if (!writeOff) throw new NotFoundException('Write-off not found');

        return this.db.$transaction(async (tx) => {
            const customer = await tx.customer.findFirst({
                where: { id: writeOff.customer_id, tenant_id: tenantId },
                select: { id: true, name: true, due_balance: true },
            });
            if (!customer) throw new NotFoundException('Customer not found');

            await voidAutoPostedVoucher(tx, tenantId, 'bad_debt_write_off', writeOffId);

            await tx.customerCreditTransaction.delete({ where: { id: writeOffId } });

            const restoredDue = Number(customer.due_balance) + Number(writeOff.amount);
            await tx.customer.update({
                where: { id: customer.id },
                data: { due_balance: restoredDue },
            });

            // `credit_enabled` is deliberately left as it is. The write-off may
            // have turned it off, or an owner may have done so independently,
            // and the two are indistinguishable from this row — so letting the
            // customer buy on credit again stays a deliberate act on their
            // record rather than a side effect of undoing a write-off.
            return { reversed: true, id: writeOffId, due_balance: restoredDue };
        });
    }

    /** Every debt this workspace has forgiven — the bad-debt register. */
    async listWriteOffs(
        tenantId: string,
        query: ListCustomerWriteOffsQueryDto & { timezone: string },
    ): Promise<PaginatedResult<any>> {
        const page = query.page ?? 1;
        const limit = Math.min(query.limit ?? 20, 100);
        const skip = (page - 1) * limit;

        const where: any = { tenant_id: tenantId, type: 'WRITE_OFF' };
        if (query.customerId) where.customer_id = query.customerId;
        // The reason rides in reference_id beside reference_type 'BAD_DEBT'; see
        // writeOffDebt. No column was added for it because the reason never
        // steers a posting — it is a label on the row.
        if (query.reason) where.reference_id = query.reason;

        const created = createdAtRange(query.from, query.to, query.timezone);
        if (created) where.created_at = created;

        const [items, total] = await Promise.all([
            this.db.customerCreditTransaction.findMany({
                where,
                include: {
                    customer: { select: { id: true, name: true, phone: true, customer_code: true } },
                    creator: { select: { id: true, name: true } },
                },
                orderBy: { created_at: 'desc' },
                skip,
                take: limit,
            }),
            this.db.customerCreditTransaction.count({ where }),
        ]);

        const enriched = await this.enrichPaymentsWithVouchers(tenantId, items, 'bad_debt_write_off');
        return paginate(
            enriched.map((item: any) => ({ ...item, reason: item.reference_id })),
            total,
            page,
            limit,
        );
    }

    /**
     * Who owes money, and how old each unpaid taka is.
     *
     * Aged from the SAME ledger that produces `due_balance`, not from credit
     * sales alone. The original version read `type: 'CREDIT_SALE'` and nothing
     * else, so every payment, payout and return adjustment was invisible to it
     * and the report showed lifetime credit sales as though none had ever been
     * settled. `ageBalance` applies each receipt to the oldest open charge, the
     * way the shopkeeper does on paper, and ages only what survives.
     *
     * `ledgerDueDelta` is the single place that knows which transaction types
     * raise a due and which settle one, so this report cannot disagree with the
     * customer's own statement about what a row means.
     */
    async getDueAgingReport(tenantId: string) {
        const now = new Date();

        const transactions = await this.db.customerCreditTransaction.findMany({
            where: { tenant_id: tenantId },
            select: {
                customer_id: true,
                type: true,
                amount: true,
                created_at: true,
                customer: { select: { id: true, name: true, phone: true } },
            },
            orderBy: { created_at: 'asc' },
        });

        const byCustomer = new Map<string, {
            customer: { id: string; name: string; phone: string };
            entries: AgingEntry[];
        }>();

        for (const tx of transactions) {
            let bucket = byCustomer.get(tx.customer_id);
            if (!bucket) {
                bucket = { customer: tx.customer as any, entries: [] };
                byCustomer.set(tx.customer_id, bucket);
            }
            bucket.entries.push({
                date: tx.created_at,
                delta: this.ledgerDueDelta(tx.type, Number(tx.amount)),
            });
        }

        const rows = [];
        for (const { customer, entries } of byCustomer.values()) {
            const aged = ageBalance(entries, now);
            if (aged.outstanding <= 0) continue;

            rows.push({
                customer,
                bucket_0_30: aged.buckets.current,
                bucket_31_60: aged.buckets.overdue_31_60,
                bucket_61_90: aged.buckets.overdue_61_90,
                bucket_90_plus: aged.buckets.overdue_90_plus,
                total: aged.outstanding,
            });
        }

        return rows;
    }

    async importRows(
        tenantId: string,
        rows: Record<string, unknown>[],
        mode: 'skip' | 'upsert',
    ): Promise<ImportResult> {
        const text = (value: unknown): string | null => {
            if (value === undefined || value === null) return null;
            return String(value).trim() || null;
        };

        const resolveGroupId = async (name: string | null): Promise<string | null> => {
            if (!name) return null;
            const group = await this.db.customerGroup.findFirst({
                where: { tenant_id: tenantId, name: { equals: name, mode: 'insensitive' } },
                select: { id: true },
            });
            return group?.id ?? null;
        };

        return runImport(rows, mode, tenantId, {
            requiredFields: ['name'],
            castRow: (raw) => ({
                customer_code: text(raw.customer_code),
                name: String(raw.name ?? '').trim(),
                owner_name: text(raw.owner_name),
                phone: text(raw.phone),
                email: text(raw.email),
                address: text(raw.address),
                customer_group_name: text(raw.customer_group_name),
            }),
            findDuplicate: async (row) => {
                if (row.customer_code) {
                    const byCode = await this.db.customer.findUnique({
                        where: {
                            tenant_id_customer_code: { tenant_id: tenantId, customer_code: row.customer_code },
                        },
                        select: { id: true },
                    });
                    if (byCode) return byCode.id;
                }
                if (row.phone) {
                    const byPhone = await this.db.customer.findUnique({
                        where: { tenant_id_phone: { tenant_id: tenantId, phone: row.phone } },
                        select: { id: true },
                    });
                    if (byPhone) return byPhone.id;
                }
                if (row.email) {
                    const byEmail = await this.db.customer.findFirst({
                        where: { tenant_id: tenantId, email: row.email },
                        select: { id: true },
                    });
                    if (byEmail) return byEmail.id;
                }
                return null;
            },
            create: async (row) => {
                const customer_group_id = await resolveGroupId(row.customer_group_name);
                await this.withCustomerCode(tenantId, row.customer_code, (customer_code) =>
                    this.db.customer.create({
                        data: {
                            tenant_id: tenantId,
                            customer_code,
                            name: row.name,
                            owner_name: row.owner_name,
                            phone: row.phone,
                            email: row.email,
                            address: row.address,
                            customer_group_id,
                        },
                    }),
                );
            },
            update: async (id, row) => {
                const customer_group_id =
                    row.customer_group_name !== null ? await resolveGroupId(row.customer_group_name) : undefined;
                await this.db.customer.update({
                    where: { id },
                    data: {
                        name: row.name,
                        ...(row.owner_name !== null ? { owner_name: row.owner_name } : {}),
                        ...(row.phone !== null ? { phone: row.phone } : {}),
                        ...(row.email !== null ? { email: row.email } : {}),
                        ...(row.address !== null ? { address: row.address } : {}),
                        ...(customer_group_id !== undefined ? { customer_group_id } : {}),
                    },
                });
            },
        });
    }
}
