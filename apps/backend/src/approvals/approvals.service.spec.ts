import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';
import { ApprovalNotifier } from './approval-notifier';
import type { ApprovalItem } from './approval-kinds';

jest.mock('../database/member-access.loader', () => ({
    loadMemberStoreGrants: jest.fn(),
}));
import { loadMemberStoreGrants } from '../database/member-access.loader';

const item = (kind: ApprovalItem['kind'], id: string, at: string): ApprovalItem => ({
    kind,
    id,
    title: id,
    amount: null,
    requested_by: null,
    requested_at: new Date(at),
    branch: null,
    details: [],
});

function provider(kind: ApprovalItem['kind'], branchHeld: boolean, items: ApprovalItem[] = []) {
    return {
        kind,
        branchHeld,
        pending: jest.fn().mockResolvedValue(items),
        branchOf: jest.fn().mockResolvedValue(branchHeld ? 'store-1' : null),
        approve: jest.fn().mockResolvedValue(undefined),
        reject: jest.fn().mockResolvedValue(undefined),
    };
}

describe('ApprovalsService', () => {
    const owner = { tenantId: 't1', userId: 'u-owner', userRole: 'OWNER', storeId: 'store-1', timezone: 'Asia/Dhaka' } as any;
    const member = { tenantId: 't1', userId: 'u-1', userRole: 'MANAGER', storeId: 'store-1', timezone: 'Asia/Dhaka' } as any;
    let providers: Record<string, ReturnType<typeof provider>>;
    let service: ApprovalsService;

    beforeEach(() => {
        providers = {
            expense: provider('EXPENSE_CLAIM', false, [item('EXPENSE_CLAIM', 'claim-1', '2026-10-07T05:00:00Z')]),
            leave: provider('LEAVE_REQUEST', false, [item('LEAVE_REQUEST', 'leave-1', '2026-10-06T05:00:00Z')]),
            demand: provider('PRODUCT_DEMAND', true, [item('PRODUCT_DEMAND', 'demand-1', '2026-10-07T09:00:00Z')]),
            transfer: provider('WAREHOUSE_TRANSFER', true),
            voucher: provider('VOUCHER', false),
        };
        service = new ApprovalsService(
            {} as any,
            {} as any,
            providers.expense as any,
            providers.leave as any,
            providers.demand as any,
            providers.transfer as any,
            providers.voucher as any,
        );
    });

    it('gives an owner every kind, oldest first, with counts', async () => {
        const inbox = await service.inbox(owner);

        expect(inbox.items.map((i) => i.id)).toEqual(['leave-1', 'claim-1', 'demand-1']);
        expect(inbox.total).toBe(3);
        expect(inbox.counts).toEqual({
            EXPENSE_CLAIM: 1, LEAVE_REQUEST: 1, PRODUCT_DEMAND: 1, WAREHOUSE_TRANSFER: 0, VOUCHER: 0,
        });
        // No branch narrowing for an owner.
        expect(providers.demand.pending).toHaveBeenCalledWith('t1', null);
    });

    it('gives a member only the kinds they hold, and branch kinds only for their branches', async () => {
        (loadMemberStoreGrants as jest.Mock).mockResolvedValue(
            new Map([
                ['store-1', new Set(['APPROVE_PRODUCT_DEMAND', 'APPROVE_VOUCHER'])],
                ['store-2', new Set(['APPROVE_PRODUCT_DEMAND'])],
            ]),
        );

        const inbox = await service.inbox(member);

        expect(inbox.kinds).toEqual(['PRODUCT_DEMAND']);
        expect(providers.demand.pending).toHaveBeenCalledWith('t1', ['store-1', 'store-2']);
        // Vouchers need the ledger too, as the web's approve endpoint does.
        expect(providers.voucher.pending).not.toHaveBeenCalled();
        expect(providers.expense.pending).not.toHaveBeenCalled();
    });

    it('decides through the kind’s own provider', async () => {
        await service.approve(owner, 'EXPENSE_CLAIM', 'claim-1', '  ok  ');
        expect(providers.expense.approve).toHaveBeenCalledWith({ tenantId: 't1', userId: 'u-owner' }, 'claim-1', 'ok');

        await service.reject(owner, 'LEAVE_REQUEST', 'leave-1', ' Too close to Eid ');
        expect(providers.leave.reject).toHaveBeenCalledWith({ tenantId: 't1', userId: 'u-owner' }, 'leave-1', 'Too close to Eid');
    });

    it('refuses an unknown kind, and a kind the member cannot decide', async () => {
        await expect(service.approve(owner, 'PAYROLL_RUN', 'x')).rejects.toBeInstanceOf(NotFoundException);

        (loadMemberStoreGrants as jest.Mock).mockResolvedValue(new Map([['store-1', new Set(['APPROVE_PRODUCT_DEMAND'])]]));
        await expect(service.approve(member, 'EXPENSE_CLAIM', 'claim-1')).rejects.toBeInstanceOf(ForbiddenException);
        expect(providers.expense.approve).not.toHaveBeenCalled();
    });

    it("refuses an entry of a branch where the member cannot approve", async () => {
        (loadMemberStoreGrants as jest.Mock).mockResolvedValue(new Map([['store-2', new Set(['APPROVE_PRODUCT_DEMAND'])]]));
        // branchOf answers store-1.
        await expect(service.reject(member, 'PRODUCT_DEMAND', 'demand-1', 'no')).rejects.toBeInstanceOf(ForbiddenException);
        expect(providers.demand.reject).not.toHaveBeenCalled();
    });

    it('passes on the provider’s "already decided"', async () => {
        providers.expense.approve.mockRejectedValue(new ConflictException('This expense claim has already been decided.'));
        await expect(service.approve(owner, 'EXPENSE_CLAIM', 'claim-1')).rejects.toBeInstanceOf(ConflictException);
    });
});

describe('ApprovalNotifier', () => {
    it('tells every approver but the requester, linking to the web page for the kind', async () => {
        const directory = { userIds: jest.fn().mockResolvedValue(['u-owner', 'u-hr', 'u-requester']) };
        const notifications = { create: jest.fn().mockResolvedValue({}) };
        const notifier = new ApprovalNotifier(directory as any, notifications as any);

        await notifier.requested({
            tenantId: 't1',
            kind: 'LEAVE_REQUEST',
            id: 'leave-1',
            summary: 'Rina · Casual leave, 2 days',
            requestedBy: 'u-requester',
        });

        expect(directory.userIds).toHaveBeenCalledWith('t1', 'MANAGE_HR', undefined);
        expect(notifications.create.mock.calls.map((c) => c[1])).toEqual(['u-owner', 'u-hr']);
        expect(notifications.create).toHaveBeenCalledWith(
            't1', 'u-hr', 'APPROVAL_REQUEST', 'Leave request waiting for you', 'Rina · Casual leave, 2 days', '/hr/leaves',
        );
    });

    it('never throws: the entry is already saved', async () => {
        const notifier = new ApprovalNotifier(
            { userIds: jest.fn().mockRejectedValue(new Error('db down')) } as any,
            { create: jest.fn() } as any,
        );
        await expect(
            notifier.requested({ tenantId: 't1', kind: 'EXPENSE_CLAIM', id: 'c', summary: 's' }),
        ).resolves.toBeUndefined();
    });
});
