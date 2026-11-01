import { Meet71MembershipService } from './meet71-membership.service';

function fakeDb() {
    return {
        meet71DenyEntry: {
            findUnique: jest.fn(),
            findMany: jest.fn(),
            upsert: jest.fn(),
            deleteMany: jest.fn(),
        },
        meet71AllowEntry: {
            findMany: jest.fn(),
            findUnique: jest.fn(),
            upsert: jest.fn(),
            delete: jest.fn(),
            deleteMany: jest.fn(),
        },
        meet71Member: {
            findUnique: jest.fn(),
            findMany: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            upsert: jest.fn(),
            deleteMany: jest.fn(),
        },
        meet71Room: {
            findUnique: jest.fn(),
            findMany: jest.fn(),
            update: jest.fn(),
        },
        $transaction: jest.fn(),
    };
}

function fakeAudit() {
    return { log: jest.fn().mockResolvedValue(undefined) };
}

describe('Meet71MembershipService', () => {
    let db: ReturnType<typeof fakeDb>;
    let audit: ReturnType<typeof fakeAudit>;
    let service: Meet71MembershipService;

    beforeEach(() => {
        db = fakeDb();
        audit = fakeAudit();
        db.$transaction.mockImplementation(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db));
        service = new Meet71MembershipService(db as never, audit as never);
    });

    it('matches exact email case-insensitively', () => {
        expect(service.matches('  Foo@ERP71.com ', 'foo@erp71.com')).toBe(true);
        expect(service.matches('foo@erp71.com', 'FOO@ERP71.COM')).toBe(true);
        expect(service.matches('foo@erp71.com', 'bar@erp71.com')).toBe(false);
    });

    it('matches @erp71.com suffix and rejects user@noterp71.com', () => {
        expect(service.matches('user@erp71.com', '@erp71.com')).toBe(true);
        expect(service.matches('USER@ERP71.COM', '  @ERP71.COM  ')).toBe(true);
        expect(service.matches('user@noterp71.com', '@erp71.com')).toBe(false);
    });

    it('deny row wins over @erp71.com', async () => {
        db.meet71DenyEntry.findUnique.mockResolvedValue({ email: 'blocked@erp71.com' });
        db.meet71AllowEntry.findMany.mockResolvedValue([{ pattern: '@erp71.com' }]);
        db.meet71Member.findUnique.mockResolvedValue({
            email: 'blocked@erp71.com',
            display_name: 'Blocked',
            is_admin: true,
            can_create_room: true,
            invite_quota: -1,
            invites_used: 0,
        });

        await expect(service.evaluate('blocked@erp71.com')).resolves.toEqual({ allowed: false });
    });

    it('evaluate does not call prisma.meet71Member.create', async () => {
        db.meet71DenyEntry.findUnique.mockResolvedValue(null);
        db.meet71AllowEntry.findMany.mockResolvedValue([{ pattern: '@erp71.com' }]);
        db.meet71Member.findUnique.mockResolvedValue(null);

        const result = await service.evaluate('new@erp71.com');

        expect(db.meet71Member.create).not.toHaveBeenCalled();
        expect(result).toEqual({
            allowed: true,
            email: 'new@erp71.com',
            displayName: null,
            isAdmin: false,
            canCreateRoom: false,
            inviteQuota: 0,
            invitesUsed: 0,
            invitesRemaining: 0,
        });
    });

    it('upsertOnSignIn on domain match inserts can_create_room false and invite_quota 0', async () => {
        db.meet71DenyEntry.findUnique.mockResolvedValue(null);
        db.meet71AllowEntry.findMany.mockResolvedValue([{ pattern: '@erp71.com' }]);
        db.meet71Member.findUnique.mockResolvedValue(null);
        db.meet71Member.create.mockResolvedValue({
            email: 'new@erp71.com',
            display_name: 'New User',
            is_admin: false,
            can_create_room: false,
            invite_quota: 0,
            invites_used: 0,
        });

        const result = await service.upsertOnSignIn('New@ERP71.com', 'New User');

        expect(db.meet71Member.create).toHaveBeenCalledWith({
            data: {
                email: 'new@erp71.com',
                display_name: 'New User',
                can_create_room: false,
                invite_quota: 0,
                is_admin: false,
            },
        });
        expect(result).toEqual({
            allowed: true,
            email: 'new@erp71.com',
            displayName: 'New User',
            isAdmin: false,
            canCreateRoom: false,
            inviteQuota: 0,
            invitesUsed: 0,
            invitesRemaining: 0,
        });
    });

    it('upsertOnSignIn with deny returns allowed false and does not insert', async () => {
        db.meet71DenyEntry.findUnique.mockResolvedValue({ email: 'blocked@erp71.com' });
        db.meet71AllowEntry.findMany.mockResolvedValue([{ pattern: '@erp71.com' }]);

        await expect(service.upsertOnSignIn('blocked@erp71.com', 'Blocked')).resolves.toEqual({
            allowed: false,
        });
        expect(db.meet71Member.create).not.toHaveBeenCalled();
        expect(db.meet71Member.update).not.toHaveBeenCalled();
    });

    it('upsertOnSignIn does not reset flags on an existing invited member', async () => {
        const existing = {
            email: 'invited@erp71.com',
            display_name: 'Invited User',
            is_admin: false,
            can_create_room: true,
            invite_quota: 5,
            invites_used: 2,
        };
        db.meet71DenyEntry.findUnique.mockResolvedValue(null);
        db.meet71AllowEntry.findMany.mockResolvedValue([{ pattern: '@erp71.com' }]);
        db.meet71Member.findUnique.mockResolvedValue(existing);
        db.meet71Member.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
            ...existing,
            ...data,
        }));

        const result = await service.upsertOnSignIn('invited@erp71.com', 'New Name');

        expect(db.meet71Member.create).not.toHaveBeenCalled();
        expect(result).toEqual({
            allowed: true,
            email: 'invited@erp71.com',
            displayName: 'New Name',
            isAdmin: false,
            canCreateRoom: true,
            inviteQuota: 5,
            invitesUsed: 2,
            invitesRemaining: 3,
        });
        expect(db.meet71Member.update).toHaveBeenCalledWith({
            where: { email: 'invited@erp71.com' },
            data: { display_name: 'New Name' },
        });
    });

    it('DELETE member covered only by @domain inserts Meet71DenyEntry lowercase', async () => {
        db.meet71Member.deleteMany.mockResolvedValue({ count: 1 });
        db.meet71AllowEntry.deleteMany.mockResolvedValue({ count: 0 });
        db.meet71AllowEntry.findMany.mockResolvedValue([{ pattern: '@erp71.com' }]);
        db.meet71DenyEntry.upsert.mockResolvedValue({ id: 'deny-1', email: 'blocked@erp71.com' });

        await service.deleteMember('Blocked@ERP71.com', { userId: 'admin-1', email: 'nayeem.ahmad@gmail.com' });

        expect(db.meet71DenyEntry.upsert).toHaveBeenCalledWith({
            where: { email: 'blocked@erp71.com' },
            create: { email: 'blocked@erp71.com', created_by: 'nayeem.ahmad@gmail.com' },
            update: {},
        });
        expect(audit.log).toHaveBeenCalledWith(
            'MEET71_DENY_ADD',
            'Meet71DenyEntry',
            expect.objectContaining({ tenantId: undefined }),
            'deny-1',
            expect.objectContaining({ email: 'blocked@erp71.com' }),
        );
    });

    it('listAdmin includes rooms newest first', async () => {
        const createdAt = new Date('2026-11-01T14:22:00.000Z');
        db.meet71AllowEntry.findMany.mockResolvedValue([]);
        db.meet71Member.findMany.mockResolvedValue([]);
        db.meet71DenyEntry.findMany.mockResolvedValue([]);
        db.meet71Room.findMany.mockResolvedValue([
            { code: 'kxp-4n2m-q8r', created_by_email: 'sara@erp71.com', created_at: createdAt },
            { code: 'otb', created_by_email: 'nayeem.ahmad@gmail.com', created_at: new Date('2026-01-01') },
        ]);

        const out = await service.listAdmin();

        expect(out.rooms).toEqual([
            { code: 'kxp-4n2m-q8r', createdByEmail: 'sara@erp71.com', createdAt },
            { code: 'otb', createdByEmail: 'nayeem.ahmad@gmail.com', createdAt: new Date('2026-01-01') },
        ]);
        expect(db.meet71Room.findMany).toHaveBeenCalledWith({ orderBy: { created_at: 'desc' }, take: 100 });
    });

    it('addAllowlist of a denied exact email throws MEET71_DENIED', async () => {
        db.meet71DenyEntry.findUnique.mockResolvedValue({ email: 'blocked@erp71.com' });

        await expect(
            service.addAllowlist('Blocked@ERP71.com', { email: 'nayeem.ahmad@gmail.com' }),
        ).rejects.toMatchObject({ response: { code: 'MEET71_DENIED' } });
        expect(db.meet71AllowEntry.upsert).not.toHaveBeenCalled();
    });
});
