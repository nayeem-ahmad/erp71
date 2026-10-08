import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AccountingService } from '../accounting/accounting.service';
import { AttendanceService } from '../attendance/attendance.service';
import { LeaveRequestStatusDto } from '../attendance/attendance.dto';
import { ExpenseClaimsService } from '../expense-claims/expense-claims.service';
import { ProductDemandsService } from '../product-demands/product-demands.service';
import { WarehouseTransfersService, TRANSFER_PENDING_APPROVAL } from '../warehouse-transfers/warehouse-transfers.service';
import type { ApprovalItem, ApprovalKind } from './approval-kinds';

/** How many of one kind the inbox shows: the oldest first, the rest on the web. */
const PER_KIND = 50;

/**
 * Which branches' entries the caller may decide: null for all of them (an
 * owner, or a kind that belongs to the whole workspace), otherwise the
 * branches where they hold the kind's permission.
 */
export type BranchScope = string[] | null;

export type DecisionContext = { tenantId: string; userId: string };

/**
 * One kind of entry in the inbox. Lists what waits and decides through the
 * module's own approve/reject path, so the permission, the audit trail and
 * every side effect (stock leaving a warehouse, leave days coming off a
 * balance) stay exactly where they were. What a provider adds is the check
 * that the entry is still waiting, answered as 409 rather than 400 so the
 * phone can say "someone else got there first".
 */
export interface ApprovalProvider {
    readonly kind: ApprovalKind;
    /** Whether entries of this kind belong to a branch (and are scoped by it). */
    readonly branchHeld: boolean;
    pending(tenantId: string, scope: BranchScope): Promise<ApprovalItem[]>;
    /** The branch an entry belongs to, or null; throws NotFound for none. */
    branchOf(tenantId: string, id: string): Promise<string | null>;
    approve(ctx: DecisionContext, id: string, note?: string): Promise<void>;
    reject(ctx: DecisionContext, id: string, reason: string): Promise<void>;
}

const day = (value: Date | null | undefined) => (value ? value.toISOString().slice(0, 10) : '—');
const money = (value: unknown) => Math.round(Number(value ?? 0) * 100) / 100;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function stillWaiting(found: { status: string } | null, waiting: string, what: string): void {
    if (!found) throw new NotFoundException(`${what} not found.`);
    if (found.status !== waiting) throw new ConflictException(`This ${what.toLowerCase()} has already been decided.`);
}

/** Lines of a stock entry, shortened to what fits a phone. */
function itemLines(items: { name: string; qty: number }[]): { label: string; value: string }[] {
    const shown = items.slice(0, 5).map((item) => ({ label: item.name, value: `× ${item.qty}` }));
    if (items.length > 5) shown.push({ label: 'And', value: plural(items.length - 5, 'more line') });
    return shown;
}

@Injectable()
export class ExpenseClaimApprovals implements ApprovalProvider {
    readonly kind = 'EXPENSE_CLAIM' as const;
    readonly branchHeld = false;

    constructor(
        private readonly db: DatabaseService,
        private readonly claims: ExpenseClaimsService,
    ) {}

    async pending(tenantId: string): Promise<ApprovalItem[]> {
        const rows = await this.db.expenseClaim.findMany({
            where: { tenant_id: tenantId, status: 'SUBMITTED', deleted_at: null },
            include: { employee: { select: { name: true } }, _count: { select: { lines: true } } },
            orderBy: { updated_at: 'asc' },
            take: PER_KIND,
        });
        return rows.map((row) => ({
            kind: this.kind,
            id: row.id,
            title: row.title,
            amount: money(row.total_amount),
            requested_by: row.employee?.name ?? null,
            requested_at: row.updated_at,
            branch: null,
            details: [
                { label: 'Claim date', value: day(row.claim_date) },
                { label: 'Lines', value: String(row._count.lines) },
                ...(row.notes ? [{ label: 'Note', value: row.notes }] : []),
            ],
        }));
    }

    async branchOf(tenantId: string, id: string) {
        const found = await this.db.expenseClaim.findFirst({ where: { id, tenant_id: tenantId, deleted_at: null }, select: { id: true } });
        if (!found) throw new NotFoundException('Expense claim not found.');
        return null;
    }

    private async decide(ctx: DecisionContext, id: string, status: 'APPROVED' | 'REJECTED', note?: string) {
        stillWaiting(
            await this.db.expenseClaim.findFirst({ where: { id, tenant_id: ctx.tenantId, deleted_at: null }, select: { status: true } }),
            'SUBMITTED',
            'Expense claim',
        );
        await this.claims.review(ctx.tenantId, id, ctx.userId, { status, approver_note: note });
    }

    approve(ctx: DecisionContext, id: string, note?: string) {
        return this.decide(ctx, id, 'APPROVED', note);
    }

    reject(ctx: DecisionContext, id: string, reason: string) {
        return this.decide(ctx, id, 'REJECTED', reason);
    }
}

@Injectable()
export class LeaveRequestApprovals implements ApprovalProvider {
    readonly kind = 'LEAVE_REQUEST' as const;
    readonly branchHeld = false;

    constructor(
        private readonly db: DatabaseService,
        private readonly attendance: AttendanceService,
    ) {}

    async pending(tenantId: string): Promise<ApprovalItem[]> {
        const rows = await this.db.leaveRequest.findMany({
            where: { tenant_id: tenantId, status: 'PENDING', deleted_at: null },
            include: {
                employee: { select: { name: true } },
                leave_type: { select: { name: true, approval_levels: true } },
            },
            orderBy: { created_at: 'asc' },
            take: PER_KIND,
        });
        return rows.map((row) => {
            const levels = row.leave_type?.approval_levels ?? 1;
            return {
                kind: this.kind,
                id: row.id,
                title: `${row.leave_type?.name ?? 'Leave'} · ${plural(row.days, 'day')}`,
                amount: null,
                requested_by: row.employee?.name ?? null,
                requested_at: row.created_at,
                branch: null,
                details: [
                    { label: 'From', value: day(row.start_date) },
                    { label: 'To', value: day(row.end_date) },
                    ...(levels > 1
                        ? [{ label: 'Approval', value: `${(row.approvals_given ?? 0) + 1} of ${levels}` }]
                        : []),
                    ...(row.reason ? [{ label: 'Reason', value: row.reason }] : []),
                ],
            };
        });
    }

    async branchOf(tenantId: string, id: string) {
        const found = await this.db.leaveRequest.findFirst({ where: { id, tenant_id: tenantId, deleted_at: null }, select: { id: true } });
        if (!found) throw new NotFoundException('Leave request not found.');
        return null;
    }

    private async decide(ctx: DecisionContext, id: string, status: LeaveRequestStatusDto, note?: string) {
        stillWaiting(
            await this.db.leaveRequest.findFirst({ where: { id, tenant_id: ctx.tenantId, deleted_at: null }, select: { status: true } }),
            'PENDING',
            'Leave request',
        );
        await this.attendance.reviewLeaveRequest(ctx.tenantId, id, ctx.userId, { status, approver_note: note });
    }

    approve(ctx: DecisionContext, id: string, note?: string) {
        return this.decide(ctx, id, LeaveRequestStatusDto.APPROVED, note);
    }

    reject(ctx: DecisionContext, id: string, reason: string) {
        return this.decide(ctx, id, LeaveRequestStatusDto.REJECTED, reason);
    }
}

@Injectable()
export class ProductDemandApprovals implements ApprovalProvider {
    readonly kind = 'PRODUCT_DEMAND' as const;
    readonly branchHeld = true;

    constructor(
        private readonly db: DatabaseService,
        private readonly demands: ProductDemandsService,
    ) {}

    async pending(tenantId: string, scope: BranchScope): Promise<ApprovalItem[]> {
        const rows = await this.db.productDemand.findMany({
            where: {
                tenant_id: tenantId,
                status: 'SUBMITTED',
                ...(scope ? { store_id: { in: scope } } : {}),
            },
            include: {
                store: { select: { name: true } },
                warehouse: { select: { name: true } },
                items: { select: { quantity_requested: true, product: { select: { name: true } } } },
            },
            orderBy: { submitted_at: 'asc' },
            take: PER_KIND,
        });
        const requesters = await namesOf(this.db, rows.map((row) => row.requested_by));
        return rows.map((row) => ({
            kind: this.kind,
            id: row.id,
            title: `${row.demand_number} · ${plural(row.items.length, 'item')}`,
            amount: null,
            requested_by: row.requested_by ? requesters.get(row.requested_by) ?? null : null,
            requested_at: row.submitted_at ?? row.created_at,
            branch: row.store?.name ?? null,
            details: [
                { label: 'For', value: row.warehouse?.name ?? '—' },
                { label: 'Priority', value: row.priority },
                ...(row.needed_by ? [{ label: 'Needed by', value: day(row.needed_by) }] : []),
                ...itemLines(row.items.map((item) => ({ name: item.product?.name ?? 'Product', qty: item.quantity_requested }))),
            ],
        }));
    }

    async branchOf(tenantId: string, id: string) {
        const found = await this.db.productDemand.findFirst({ where: { id, tenant_id: tenantId }, select: { store_id: true } });
        if (!found) throw new NotFoundException('Product demand not found.');
        return found.store_id;
    }

    private async decide(ctx: DecisionContext, id: string, status: 'APPROVED' | 'REJECTED', note?: string) {
        stillWaiting(
            await this.db.productDemand.findFirst({ where: { id, tenant_id: ctx.tenantId }, select: { status: true } }),
            'SUBMITTED',
            'Product demand',
        );
        // No lines: approved in full, as asked. Cutting quantities is the web's.
        await this.demands.review(ctx.tenantId, id, { status, reviewNote: note }, ctx.userId);
    }

    approve(ctx: DecisionContext, id: string, note?: string) {
        return this.decide(ctx, id, 'APPROVED', note);
    }

    reject(ctx: DecisionContext, id: string, reason: string) {
        return this.decide(ctx, id, 'REJECTED', reason);
    }
}

@Injectable()
export class WarehouseTransferApprovals implements ApprovalProvider {
    readonly kind = 'WAREHOUSE_TRANSFER' as const;
    readonly branchHeld = true;

    constructor(
        private readonly db: DatabaseService,
        private readonly transfers: WarehouseTransfersService,
    ) {}

    async pending(tenantId: string, scope: BranchScope): Promise<ApprovalItem[]> {
        const rows = await this.db.warehouseTransfer.findMany({
            where: {
                tenant_id: tenantId,
                status: TRANSFER_PENDING_APPROVAL,
                // Approving sends the stock out of the source: that branch's call.
                ...(scope ? { source_store_id: { in: scope } } : {}),
            },
            include: { items: { select: { quantity_sent: true, product: { select: { name: true } } } } },
            orderBy: { created_at: 'asc' },
            take: PER_KIND,
        });
        const warehouseIds = rows.flatMap((row) => [row.source_warehouse_id, row.destination_warehouse_id]);
        const warehouses = new Map(
            (
                await this.db.warehouse.findMany({
                    where: { tenant_id: tenantId, id: { in: [...new Set(warehouseIds)] } },
                    select: { id: true, name: true, store: { select: { name: true } } },
                })
            ).map((w) => [w.id, w]),
        );
        const where = (id: string) => {
            const w = warehouses.get(id);
            return w ? `${w.name} (${w.store?.name ?? 'branch'})` : '—';
        };
        return rows.map((row) => ({
            kind: this.kind,
            id: row.id,
            title: `${row.transfer_number} · ${plural(row.items.length, 'item')}`,
            amount: null,
            requested_by: null,
            requested_at: row.created_at,
            branch: warehouses.get(row.source_warehouse_id)?.store?.name ?? null,
            details: [
                { label: 'From', value: where(row.source_warehouse_id) },
                { label: 'To', value: where(row.destination_warehouse_id) },
                ...(row.notes ? [{ label: 'Note', value: row.notes }] : []),
                ...itemLines(row.items.map((item) => ({ name: item.product?.name ?? 'Product', qty: item.quantity_sent }))),
            ],
        }));
    }

    async branchOf(tenantId: string, id: string) {
        const found = await this.db.warehouseTransfer.findFirst({ where: { id, tenant_id: tenantId }, select: { source_store_id: true } });
        if (!found) throw new NotFoundException('Stock transfer not found.');
        return found.source_store_id;
    }

    private async waiting(ctx: DecisionContext, id: string) {
        stillWaiting(
            await this.db.warehouseTransfer.findFirst({ where: { id, tenant_id: ctx.tenantId }, select: { status: true } }),
            TRANSFER_PENDING_APPROVAL,
            'Stock transfer',
        );
    }

    async approve(ctx: DecisionContext, id: string) {
        await this.waiting(ctx, id);
        await this.transfers.approve(ctx.tenantId, id, ctx.userId);
    }

    async reject(ctx: DecisionContext, id: string, reason: string) {
        await this.waiting(ctx, id);
        await this.transfers.reject(ctx.tenantId, id, ctx.userId, { reason });
    }
}

/**
 * Vouchers wait only while the workspace requires approval; otherwise they
 * are born APPROVED. A voucher decision is reversible by design (an approved
 * one can later be rejected and the other way round) and has no side effect
 * beyond its status, so a check-then-call is enough here.
 */
@Injectable()
export class VoucherApprovals implements ApprovalProvider {
    readonly kind = 'VOUCHER' as const;
    readonly branchHeld = false;

    constructor(
        private readonly db: DatabaseService,
        private readonly accounting: AccountingService,
    ) {}

    async pending(tenantId: string): Promise<ApprovalItem[]> {
        const rows = await this.db.voucher.findMany({
            where: { tenant_id: tenantId, approval_status: 'PENDING' },
            include: { store: { select: { name: true } }, details: { select: { debit_amount: true } } },
            orderBy: { created_at: 'asc' },
            take: PER_KIND,
        });
        return rows.map((row) => ({
            kind: this.kind,
            id: row.id,
            title: `${row.voucher_number} · ${row.voucher_type.replace(/_/g, ' ').toLowerCase()}`,
            amount: money(row.details.reduce((sum, d) => sum + Number(d.debit_amount), 0)),
            requested_by: null,
            requested_at: row.created_at,
            branch: row.store?.name ?? null,
            details: [
                { label: 'Date', value: day(row.date) },
                ...(row.description ? [{ label: 'Narration', value: row.description }] : []),
                ...(row.reference_number ? [{ label: 'Reference', value: row.reference_number }] : []),
            ],
        }));
    }

    async branchOf(tenantId: string, id: string) {
        const found = await this.db.voucher.findFirst({ where: { id, tenant_id: tenantId }, select: { id: true } });
        if (!found) throw new NotFoundException('Voucher not found.');
        return null;
    }

    private async waiting(ctx: DecisionContext, id: string) {
        const found = await this.db.voucher.findFirst({
            where: { id, tenant_id: ctx.tenantId },
            select: { approval_status: true },
        });
        stillWaiting(found ? { status: found.approval_status } : null, 'PENDING', 'Voucher');
    }

    async approve(ctx: DecisionContext, id: string) {
        await this.waiting(ctx, id);
        await this.accounting.approveVoucher(ctx.tenantId, id, ctx.userId);
    }

    async reject(ctx: DecisionContext, id: string, reason: string) {
        await this.waiting(ctx, id);
        await this.accounting.rejectVoucher(ctx.tenantId, id, { reason }, ctx.userId);
    }
}

async function namesOf(db: DatabaseService, ids: (string | null)[]): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (wanted.length === 0) return new Map();
    const users = await db.user.findMany({ where: { id: { in: wanted } }, select: { id: true, name: true, email: true } });
    return new Map(users.map((user) => [user.id, user.name?.trim() || user.email]));
}
