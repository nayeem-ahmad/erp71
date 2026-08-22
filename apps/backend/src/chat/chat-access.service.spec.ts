import { NotFoundException } from '@nestjs/common';
import { ChatAccessService } from './chat-access.service';

function makeService(participantRow: unknown) {
    const db: any = {
        chatParticipant: {
            findFirst: jest.fn().mockResolvedValue(participantRow),
            findMany: jest.fn().mockResolvedValue([]),
        },
        tenantUser: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return { service: new ChatAccessService(db), db };
}

const membershipRow = {
    id: 'part-1',
    role: 'member',
    last_read_at: null,
    muted_until: null,
    conversation: { id: 'conv-1', kind: 'dm', title: null, archived_at: null },
};

describe('ChatAccessService.requireMembership', () => {
    it('returns the caller’s own participant row', async () => {
        const { service } = makeService(membershipRow);
        const membership = await service.requireMembership(
            { tenantId: 'ten-1', userId: 'user-1' },
            'conv-1',
        );
        expect(membership.participantId).toBe('part-1');
        expect(membership.conversationId).toBe('conv-1');
    });

    it('queries on the caller, a live membership, and the tenant together', async () => {
        const { service, db } = makeService(membershipRow);
        await service.requireMembership({ tenantId: 'ten-1', userId: 'user-1' }, 'conv-1');

        const where = db.chatParticipant.findFirst.mock.calls[0][0].where;
        expect(where.user_id).toBe('user-1');
        // A member who left keeps their row so old messages resolve to a name,
        // but must read nothing from then on.
        expect(where.left_at).toBeNull();
        // Without this, a stale x-tenant-id could reach a conversation through a
        // membership held in a different workspace.
        expect(where.conversation).toEqual({ tenant_id: 'ten-1' });
    });

    it('rejects a non-participant with NotFound, never Forbidden', async () => {
        // This is the rule that makes staff DMs private, and it has no role
        // bypass: an OWNER who is not a participant is not a reader. 403 would
        // itself confirm the conversation exists, which is already too much.
        const { service } = makeService(null);
        await expect(
            service.requireMembership({ tenantId: 'ten-1', userId: 'owner-9' }, 'conv-1'),
        ).rejects.toBeInstanceOf(NotFoundException);
    });
});

describe('ChatAccessService.filterTenantMemberIds', () => {
    it('returns only ids that belong to the workspace', async () => {
        const { service, db } = makeService(membershipRow);
        db.tenantUser.findMany.mockResolvedValue([{ user_id: 'user-2' }]);

        const result = await service.filterTenantMemberIds('ten-1', ['user-2', 'outsider']);
        expect(result).toEqual(['user-2']);
    });

    it('short-circuits on an empty list rather than querying', async () => {
        const { service, db } = makeService(membershipRow);
        expect(await service.filterTenantMemberIds('ten-1', [])).toEqual([]);
        expect(db.tenantUser.findMany).not.toHaveBeenCalled();
    });
});
