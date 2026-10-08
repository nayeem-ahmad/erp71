import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { checkedSalesRepId, listSalesReps, SALES_REP_SELECT } from './sales-rep.util';
import { DatabaseService } from '../database/database.service';
import { EncryptionService } from '../common/encryption.service';
import { autoPostFromRules, voidAutoPostedVoucher } from '../accounting/posting.utils';
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
import { DEFAULT_TENANT_TIMEZONE, parseTenantDateTime } from '../common/tenant-time.util';
import { customerLedgerDueDelta } from './customer-credit.utils';
import { CUSTOMER_PAYMENT_DISCOUNT_LEG, nextCustomerCreditNumber } from './customer-payment-number.util';
import { type CustomerScope, customerInBranchesWhere, customerScopeWhere, saleScopeWhere } from './customer-visibility';

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

/** Amounts below this are rounding dust, not money. Matches customer-credit.utils. */
const AMOUNT_EPSILON = 0.005;

const DISCOUNT_LEG = CUSTOMER_PAYMENT_DISCOUNT_LEG;

/**
 * How far past the server's clock a payment date may sit. The picker works in
 * whole minutes and the browser's clock drifts, so "now" can arrive a little
 * ahead; anything further out is a typo, not a payment.
 */
const PAYMENT_DATE_SKEW_MS = 5 * 60 * 1000;

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

    /**
     * A payment's date as the operator picked it, or undefined when they did
     * not pick one. Backdating is the point — money taken yesterday and entered
     * today — but a date in the future is refused.
     */
    private paymentDate(value: string | undefined, timeZone?: string): Date | undefined {
        if (!value) return undefined;
        const date = parseTenantDateTime(value, timeZone ?? DEFAULT_TENANT_TIMEZONE);
        if (!date) throw new BadRequestException('Invalid payment date');
        if (date.getTime() > Date.now() + PAYMENT_DATE_SKEW_MS) {
            throw new BadRequestException('Payment date cannot be in the future');
        }
        return date;
    }

    private dueDelta(type: 'PAYMENT' | 'PAYOUT', amount: number, discount = 0): number {
        return customerLedgerDueDelta(type, amount, discount);
    }

    /**
     * A payment may carry a discount — the remainder the shop lets the customer
     * off — but only on money coming in, and never more than what the payment
     * leaves due: a discount that pushed the customer into credit would be the
     * shop handing out store credit and booking it as an expense.
     */
    private assertPaymentSplit(type: 'PAYMENT' | 'PAYOUT', amount: number, discount: number, dueBefore: number) {
        if (amount < 0 || discount < 0) throw new BadRequestException('Amount and discount cannot be negative');
        if (type === 'PAYOUT') {
            if (discount > AMOUNT_EPSILON) {
                throw new BadRequestException('A discount can only be given on a payment received from the customer.');
            }
            if (amount < AMOUNT_EPSILON) throw new BadRequestException('Amount must be positive');
            return;
        }
        if (amount + discount < AMOUNT_EPSILON) {
            throw new BadRequestException('Enter an amount received, a discount, or both.');
        }
        const leftAfterPayment = Math.max(0, dueBefore - amount);
        if (discount - leftAfterPayment > AMOUNT_EPSILON) {
            throw new BadRequestException(
                `Discount of ৳${discount.toFixed(2)} is more than the ৳${leftAfterPayment.toFixed(2)} still due after this payment.`,
            );
        }
    }

    /**
     * Posts a payment's vouchers: the money on the keyless cash leg, the
     * discount as its own JOURNAL voucher (Dr Discount Allowed / Cr AR) on
     * legKey 'discount'. Two vouchers rather than one three-line entry so the
     * cash voucher stays pure cash and the discount stays a rule a tenant can
     * repoint. A discount-only settlement posts no cash voucher at all.
     */
    private async postPaymentLegs(
        tx: any,
        input: {
            tenantId: string;
            customerId: string;
            customerName: string;
            paymentId: string;
            paymentNumber: string;
            type: 'PAYMENT' | 'PAYOUT';
            amount: number;
            discount: number;
            /** The payment's own date; the vouchers are dated to match it. */
            date?: Date;
            storeId?: string;
        },
    ) {
        const isPayout = input.type === 'PAYOUT';
        const common = {
            tx,
            tenantId: input.tenantId,
            eventType: 'customer_payment' as const,
            conditionKey: 'payment_direction' as const,
            sourceModule: 'customers',
            sourceId: input.paymentId,
            referenceNumber: input.paymentNumber,
            date: input.date,
            storeId: input.storeId,
            partyType: 'CUSTOMER' as const,
            partyId: input.customerId,
        };

        const cash = input.amount > AMOUNT_EPSILON
            ? await autoPostFromRules({
                ...common,
                conditionValue: this.directionFromType(input.type),
                sourceType: isPayout ? 'customer_payout' : 'customer_payment',
                amount: input.amount,
                description: isPayout
                    ? `Customer payout — ${input.customerName}`
                    : `Customer payment — ${input.customerName}`,
            })
            : null;

        const discount = input.discount > AMOUNT_EPSILON
            ? await autoPostFromRules({
                ...common,
                conditionValue: 'discount',
                legKey: DISCOUNT_LEG,
                sourceType: 'customer_payment_discount',
                amount: input.discount,
                description: `Discount allowed — ${input.customerName}`,
            })
            : null;

        const primary = cash ?? discount;
        return {
            posting_status: primary?.postingStatus ?? 'skipped',
            voucher_id: primary?.voucherId ?? null,
            voucher_number: primary?.voucherNumber ?? null,
            discount_voucher_id: discount?.voucherId ?? null,
            discount_voucher_number: discount?.voucherNumber ?? null,
        };
    }

    /** Takes back both of a payment's vouchers. Either may be absent. */
    private async voidPaymentLegs(tx: any, tenantId: string, paymentId: string) {
        await voidAutoPostedVoucher(tx, tenantId, 'customer_payment', paymentId);
        await voidAutoPostedVoucher(tx, tenantId, 'customer_payment', paymentId, DISCOUNT_LEG);
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

        // A payment with a discount has two events on the same source id; the
        // discount one is told apart by its leg suffix.
        const isDiscountLeg = (event: { idempotency_key?: string | null }) =>
            !!event.idempotency_key?.endsWith(`:${DISCOUNT_LEG}`);
        const voucherByPaymentId = new Map(
            events.filter((event) => !isDiscountLeg(event)).map((event) => [event.source_id, event.voucher]),
        );
        const discountVoucherByPaymentId = new Map(
            events.filter(isDiscountLeg).map((event) => [event.source_id, event.voucher]),
        );

        return items.map((item) => {
            const voucher = voucherByPaymentId.get(item.id);
            const discountVoucher = discountVoucherByPaymentId.get(item.id);
            return {
                ...item,
                voucher_id: voucher?.id ?? null,
                accounting_voucher_number: voucher?.voucher_number ?? null,
                discount_voucher_id: discountVoucher?.id ?? null,
                discount_voucher_number: discountVoucher?.voucher_number ?? null,
            };
        });
    }

    private async findCreditPaymentOrThrow(tenantId: string, paymentId: string, scope: CustomerScope = null) {
        const payment = await this.db.customerCreditTransaction.findFirst({
            where: {
                id: paymentId,
                tenant_id: tenantId,
                type: { in: ['PAYMENT', 'PAYOUT'] },
                ...this.creditRowScopeWhere(scope),
            },
            include: {
                customer: { select: { id: true, name: true, phone: true, customer_code: true, due_balance: true } },
                creator: { select: { id: true, name: true } },
            },
        });
        if (!payment) throw new NotFoundException('Customer payment not found');
        return payment;
    }

    /** A credit row's customer must be in scope — see `customer-visibility.ts`. */
    private creditRowScopeWhere(scope: CustomerScope) {
        return scope ? { customer: customerInBranchesWhere(scope) } : {};
    }

    /** `store_id` as an edit names it: a branch of this tenant, or null. */
    private async checkedStoreId(tenantId: string, storeId: string | null | undefined) {
        if (storeId === undefined || storeId === null) return storeId;
        const store = await this.db.store.findFirst({
            where: { id: storeId, tenant_id: tenantId },
            select: { id: true },
        });
        if (!store) throw new BadRequestException('Branch not found.');
        return storeId;
    }

    private async generatePaymentNumber(
        tenantId: string,
        tx: any,
        txType: 'PAYMENT' | 'PAYOUT' | 'WRITE_OFF',
    ): Promise<string> {
        return nextCustomerCreditNumber(tenantId, tx, txType);
    }

    /**
     * `opts.storeId` is the branch the customer is added at — the request's
     * header branch. `opts.scope` is the caller's customer scope: a phone
     * number held by a customer outside it gets its own message, since the
     * caller cannot find that customer to pick them.
     */
    async create(
        tenantId: string,
        dto: CreateCustomerDto,
        opts: { storeId?: string; scope?: CustomerScope } = {},
    ) {
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
                const seen = !opts.scope || existing.deleted_at
                    || (await this.db.customer.count({
                        where: { id: existing.id, ...customerScopeWhere(opts.scope) },
                    })) > 0;
                throw new BadRequestException(seen
                    ? 'A customer with this phone number already exists.'
                    : 'This phone number belongs to a customer of another branch. To sell to them, enter the number in the sale screen\'s quick add — the sale makes them a customer of your branch too.');
            }
        }

        const { nid, customer_code: requestedCode, sales_rep_id, ...rest } = dto;
        const salesRepId = await checkedSalesRepId(this.db, tenantId, sales_rep_id);
        const record = await this.withCustomerCode(tenantId, requestedCode, (customer_code) =>
            this.db.customer.create({
                data: {
                    tenant_id: tenantId,
                    customer_code,
                    ...rest,
                    ...(opts.storeId ? { store_id: opts.storeId } : {}),
                    ...(salesRepId !== undefined ? { sales_rep_id: salesRepId } : {}),
                    ...(nid != null ? { nid: this.encryptNid(nid) } : {}),
                },
                include: {
                    customerGroup: true,
                    territory: true,
                    salesRep: { select: SALES_REP_SELECT },
                }
            }),
        );
        return this.decryptCustomer(record);
    }

    /** The employees a customer's sales rep can be picked from — see `listSalesReps`. */
    salesReps(tenantId: string) {
        return listSalesReps(this.db, tenantId);
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
            /** Whose customers — see `customer-visibility.ts`. Omitted: everyone's. */
            scope?: CustomerScope;
        },
    ): Promise<PaginatedResult<any>> {
        const page = opts?.page ?? 1;
        const limit = Math.min(opts?.limit ?? 20, 100);
        const skip = (page - 1) * limit;

        const where: any = { tenant_id: tenantId, deleted_at: null, ...customerScopeWhere(opts?.scope ?? null) };
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
                // The rep travels with the customer so the sale screen can
                // credit the sale to them on picking the customer.
                include: {
                    customerGroup: true,
                    territory: true,
                    salesRep: { select: SALES_REP_SELECT },
                    store: { select: { id: true, name: true } },
                },
                orderBy: resolveOrderBy(opts?.sortBy, opts?.sortDir, CUSTOMER_SORTABLE, CUSTOMER_DEFAULT_ORDER),
                skip,
                take: limit,
            }),
            this.db.customer.count({ where }),
        ]);

        return paginate(items.map(c => this.decryptCustomer(c)), total, page, limit);
    }

    /** A limited member sees the customer's sales at their own branches only. */
    async findOne(tenantId: string, id: string, scope: CustomerScope = null) {
        const customer = await this.db.customer.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null, ...customerScopeWhere(scope) },
            include: {
                customerGroup: true,
                territory: true,
                salesRep: { select: SALES_REP_SELECT },
                store: { select: { id: true, name: true } },
                sales: {
                    where: saleScopeWhere(scope),
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
        scope: CustomerScope = null,
    ) {
        const customer = await this.db.customer.findFirst({
            where: { id, tenant_id: tenantId, ...customerScopeWhere(scope) },
            select: { id: true },
        });
        if (!customer) throw new NotFoundException('Customer not found');

        const page = params?.page ?? 1;
        const limit = Math.min(params?.limit ?? 20, 100);
        const skip = (page - 1) * limit;

        const where: any = { customer_id: id, ...saleScopeWhere(scope) };
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

    async getSegmentStats(tenantId: string, scope: CustomerScope = null) {
        const customers = await this.db.customer.findMany({
            where: { tenant_id: tenantId, ...customerScopeWhere(scope) },
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

    /**
     * `canSetBranch`: only a member who sees every customer may move one to
     * another branch — a limited member could otherwise hand a customer off to
     * a branch they cannot see, or claim one they have no sale with.
     */
    async update(
        tenantId: string,
        id: string,
        dto: UpdateCustomerDto,
        opts: { scope?: CustomerScope; canSetBranch?: boolean } = {},
    ) {
        const customer = await this.db.customer.findFirst({
            where: { id, tenant_id: tenantId, ...customerScopeWhere(opts.scope ?? null) },
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

        const { nid, sales_rep_id, store_id, ...rest } = dto;
        if (rest.customer_code) rest.customer_code = rest.customer_code.trim();
        if (store_id !== undefined && store_id !== customer.store_id && opts.canSetBranch === false) {
            throw new ForbiddenException('Only a member who sees every branch can change a customer\'s branch.');
        }
        const salesRepId = await checkedSalesRepId(this.db, tenantId, sales_rep_id);
        const storeId = await this.checkedStoreId(tenantId, store_id);
        const record = await this.db.customer.update({
            where: { id },
            data: {
                ...rest,
                ...(storeId !== undefined ? { store_id: storeId } : {}),
                ...(salesRepId !== undefined ? { sales_rep_id: salesRepId } : {}),
                ...(nid != null ? { nid: this.encryptNid(nid) } : {}),
            },
            include: {
                customerGroup: true,
                territory: true,
                salesRep: { select: SALES_REP_SELECT },
            }
        });
        return this.decryptCustomer(record);
    }

    async getAnalytics(tenantId: string, id: string, scope: CustomerScope = null) {
        const customer = await this.db.customer.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null, ...customerScopeWhere(scope) },
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
        scope: CustomerScope = null,
    ) {
        const customer = await this.db.customer.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null, ...customerScopeWhere(scope) },
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
        scope: CustomerScope = null,
    ) {
        const customer = await this.db.customer.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null, ...customerScopeWhere(scope) },
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
                discount_amount: Number(tx.discount_amount ?? 0),
                balance_before: balanceAfter - customerLedgerDueDelta(tx.type, amount, Number(tx.discount_amount ?? 0)),
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
        query: ListCustomerCreditPaymentsQueryDto & { timezone: string; scope?: CustomerScope },
    ): Promise<PaginatedResult<any>> {
        const page = query.page ?? 1;
        const limit = Math.min(query.limit ?? 20, 100);
        const skip = (page - 1) * limit;

        const where: any = {
            tenant_id: tenantId,
            type: { in: ['PAYMENT', 'PAYOUT'] },
            ...this.creditRowScopeWhere(query.scope ?? null),
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

    async getCreditPayment(tenantId: string, paymentId: string, scope: CustomerScope = null) {
        const payment = await this.findCreditPaymentOrThrow(tenantId, paymentId, scope);
        const [enriched] = await this.enrichPaymentsWithVouchers(tenantId, [payment]);
        return enriched;
    }

    async updateCreditPayment(
        tenantId: string,
        paymentId: string,
        dto: UpdateCreditPaymentDto,
        storeId?: string,
        scope: CustomerScope = null,
        timeZone?: string,
    ) {
        const payment = await this.findCreditPaymentOrThrow(tenantId, paymentId, scope);
        const oldType = payment.type as 'PAYMENT' | 'PAYOUT';
        const oldAmount = Number(payment.amount);
        const oldDiscount = Number(payment.discount_amount ?? 0);
        const customerId = payment.customer_id;

        const newDirection = dto.direction ?? this.directionFromType(oldType);
        const newType = this.typeFromDirection(newDirection);
        const newAmount = dto.amount ?? oldAmount;
        const newDiscount = dto.discount ?? oldDiscount;
        const newNotes = dto.notes !== undefined ? dto.notes : payment.notes;
        // Kept when not changed: the vouchers are voided and reposted below,
        // and a repost left undated would move an old payment into today.
        const newDate = this.paymentDate(dto.date, timeZone) ?? payment.created_at;

        return this.db.$transaction(async (tx) => {
            const customer = await tx.customer.findFirst({
                where: { id: customerId, tenant_id: tenantId, deleted_at: null },
                select: { id: true, name: true, due_balance: true },
            });
            if (!customer) throw new NotFoundException('Customer not found');

            const dueWithoutPayment = Number(customer.due_balance) - this.dueDelta(oldType, oldAmount, oldDiscount);
            this.assertPaymentSplit(newType, newAmount, newDiscount, dueWithoutPayment);

            await this.voidPaymentLegs(tx, tenantId, paymentId);

            const balanceAfter = dueWithoutPayment + this.dueDelta(newType, newAmount, newDiscount);

            const updated = await tx.customerCreditTransaction.update({
                where: { id: paymentId },
                data: {
                    type: newType,
                    amount: newAmount,
                    discount_amount: newDiscount,
                    balance_after: balanceAfter,
                    notes: newNotes,
                    created_at: newDate,
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

            const posting = await this.postPaymentLegs(tx, {
                tenantId,
                customerId,
                customerName: customer.name,
                paymentId,
                paymentNumber: payment.payment_number ?? paymentId,
                type: newType,
                amount: newAmount,
                discount: newDiscount,
                date: newDate,
                storeId,
            });

            return {
                ...updated,
                posting_status: posting.posting_status,
                voucher_id: posting.voucher_id,
                accounting_voucher_number: posting.voucher_number,
                discount_voucher_id: posting.discount_voucher_id,
                discount_voucher_number: posting.discount_voucher_number,
            };
        });
    }

    async deleteCreditPayment(tenantId: string, paymentId: string, scope: CustomerScope = null) {
        const payment = await this.findCreditPaymentOrThrow(tenantId, paymentId, scope);
        const oldType = payment.type as 'PAYMENT' | 'PAYOUT';
        const oldAmount = Number(payment.amount);
        const oldDiscount = Number(payment.discount_amount ?? 0);

        return this.db.$transaction(async (tx) => {
            const customer = await tx.customer.findFirst({
                where: { id: payment.customer_id, tenant_id: tenantId },
                select: { id: true, due_balance: true },
            });
            if (!customer) throw new NotFoundException('Customer not found');

            const newDue = Number(customer.due_balance) - this.dueDelta(oldType, oldAmount, oldDiscount);

            await this.voidPaymentLegs(tx, tenantId, paymentId);

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
        scope: CustomerScope = null,
        timeZone?: string,
    ) {
        const customer = await this.db.customer.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null, ...customerScopeWhere(scope) },
            select: { id: true, name: true, due_balance: true },
        });
        if (!customer) throw new NotFoundException('Customer not found');

        const direction = dto.direction ?? CustomerPaymentDirectionDto.RECEIVE;
        const txType = this.typeFromDirection(direction);
        const discount = dto.discount ?? 0;

        const currentDue = Number(customer.due_balance);
        this.assertPaymentSplit(txType, dto.amount, discount, currentDue);
        const balanceAfter = currentDue + this.dueDelta(txType, dto.amount, discount);
        const paymentDate = this.paymentDate(dto.date, timeZone) ?? new Date();

        return this.db.$transaction(async (tx) => {
            const payment_number = await this.generatePaymentNumber(tenantId, tx, txType);

            const payment = await tx.customerCreditTransaction.create({
                data: {
                    tenant_id: tenantId,
                    customer_id: id,
                    type: txType,
                    amount: dto.amount,
                    discount_amount: discount,
                    balance_after: balanceAfter,
                    payment_number,
                    notes: dto.notes,
                    created_by: userId,
                    created_at: paymentDate,
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

            const posting = await this.postPaymentLegs(tx, {
                tenantId,
                customerId: id,
                customerName: customer.name,
                paymentId: payment.id,
                paymentNumber: payment_number,
                type: txType,
                amount: dto.amount,
                discount,
                date: paymentDate,
                storeId,
            });

            return { ...payment, ...posting };
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
        scope: CustomerScope = null,
    ) {
        const customer = await this.db.customer.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null, ...customerScopeWhere(scope) },
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
    async reverseWriteOff(tenantId: string, writeOffId: string, scope: CustomerScope = null) {
        const writeOff = await this.db.customerCreditTransaction.findFirst({
            where: { id: writeOffId, tenant_id: tenantId, type: 'WRITE_OFF', ...this.creditRowScopeWhere(scope) },
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
        query: ListCustomerWriteOffsQueryDto & { timezone: string; scope?: CustomerScope },
    ): Promise<PaginatedResult<any>> {
        const page = query.page ?? 1;
        const limit = Math.min(query.limit ?? 20, 100);
        const skip = (page - 1) * limit;

        const where: any = { tenant_id: tenantId, type: 'WRITE_OFF', ...this.creditRowScopeWhere(query.scope ?? null) };
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
     * `customerLedgerDueDelta` is the single place that knows which transaction types
     * raise a due and which settle one, so this report cannot disagree with the
     * customer's own statement about what a row means.
     */
    async getDueAgingReport(tenantId: string, scope: CustomerScope = null) {
        const now = new Date();

        const transactions = await this.db.customerCreditTransaction.findMany({
            where: { tenant_id: tenantId, ...this.creditRowScopeWhere(scope) },
            select: {
                customer_id: true,
                type: true,
                amount: true,
                discount_amount: true,
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
                delta: customerLedgerDueDelta(tx.type, Number(tx.amount), Number(tx.discount_amount ?? 0)),
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
        /** The branch new rows are added at — the request's header branch. */
        storeId?: string,
        /** An upsert may not overwrite a customer outside the importer's scope. */
        scope: CustomerScope = null,
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
                            ...(storeId ? { store_id: storeId } : {}),
                        },
                    }),
                );
            },
            update: async (id, row) => {
                if (scope && !(await this.db.customer.count({ where: { id, ...customerScopeWhere(scope) } }))) {
                    throw new BadRequestException('matches a customer of another branch — not updated');
                }
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
