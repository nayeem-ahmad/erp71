import { Meet71InviteService } from './meet71-invite.service';

const ACTOR_EMAIL = 'actor@erp71.com';

function fakeDb() {
    return {
        meet71DenyEntry: {
            findUnique: jest.fn(),
            delete: jest.fn(),
            deleteMany: jest.fn(),
        },
        meet71AllowEntry: {
            upsert: jest.fn(),
            create: jest.fn(),
        },
        meet71Member: {
            findUnique: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            upsert: jest.fn(),
        },
        $queryRaw: jest.fn(),
        $transaction: jest.fn(),
    };
}

describe('Meet71InviteService', () => {
    let db: ReturnType<typeof fakeDb>;
    let email: { sendMeet71Invite: jest.Mock };
    let audit: { log: jest.Mock };
    let service: Meet71InviteService;
    let actor: {
        email: string;
        display_name: string;
        is_admin: boolean;
        can_create_room: boolean;
        invite_quota: number;
        invites_used: number;
    };
    let members: Record<string, { email: string; can_create_room: boolean; invite_quota: number; invites_used: number }>;

    beforeEach(() => {
        db = fakeDb();
        email = { sendMeet71Invite: jest.fn().mockResolvedValue(undefined) };
        audit = { log: jest.fn().mockResolvedValue(undefined) };
        actor = {
            email: ACTOR_EMAIL,
            display_name: 'Actor',
            is_admin: false,
            can_create_room: true,
            invite_quota: 5,
            invites_used: 2,
        };
        members = {};
        db.$transaction.mockImplementation(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db));
        db.$queryRaw.mockResolvedValue([]);
        db.meet71DenyEntry.findUnique.mockResolvedValue(null);
        db.meet71Member.findUnique.mockImplementation(async ({ where }: { where: { email: string } }) => {
            if (where.email === actor.email) return { ...actor };
            return members[where.email] ?? null;
        });
        db.meet71Member.update.mockImplementation(async ({ data }: { data: { invites_used?: { increment: number } } }) => {
            if (data.invites_used?.increment) {
                actor.invites_used += data.invites_used.increment;
            }
            return { ...actor };
        });
        db.meet71AllowEntry.upsert.mockResolvedValue({
            id: 'allow-1',
            pattern: 'new@erp71.com',
            kind: 'EMAIL',
        });
        db.meet71Member.create.mockResolvedValue({
            email: 'new@erp71.com',
            can_create_room: false,
            invite_quota: 0,
            is_admin: false,
        });
        service = new Meet71InviteService(db as never, email as never, audit as never);
    });

    it('invite of @domain is 400 MEET71_INVITE_NOT_EMAIL', async () => {
        await expect(service.invite({ email: '@erp71.com', actorEmail: ACTOR_EMAIL })).rejects.toMatchObject({
            response: { code: 'MEET71_INVITE_NOT_EMAIL' },
            status: 400,
        });
        expect(db.meet71Member.create).not.toHaveBeenCalled();
        expect(email.sendMeet71Invite).not.toHaveBeenCalled();
        expect(db.meet71Member.update).not.toHaveBeenCalled();
    });

    it('invite of denied email is 403 MEET71_DENIED and deny row remains', async () => {
        db.meet71DenyEntry.findUnique.mockResolvedValue({ email: 'blocked@erp71.com' });

        await expect(
            service.invite({ email: 'Blocked@ERP71.com', actorEmail: ACTOR_EMAIL, unlimited: true }),
        ).rejects.toMatchObject({
            response: { code: 'MEET71_DENIED' },
            status: 403,
        });
        expect(db.meet71DenyEntry.delete).not.toHaveBeenCalled();
        expect(db.meet71DenyEntry.deleteMany).not.toHaveBeenCalled();
        expect(db.meet71Member.create).not.toHaveBeenCalled();
        expect(db.meet71AllowEntry.upsert).not.toHaveBeenCalled();
        expect(email.sendMeet71Invite).not.toHaveBeenCalled();
        expect(db.meet71Member.update).not.toHaveBeenCalled();
    });

    it('resend of denied email is 403 MEET71_DENIED', async () => {
        db.meet71DenyEntry.findUnique.mockResolvedValue({ email: 'blocked@erp71.com' });
        members['blocked@erp71.com'] = {
            email: 'blocked@erp71.com',
            can_create_room: false,
            invite_quota: 0,
            invites_used: 0,
        };

        await expect(
            service.invite({ email: 'blocked@erp71.com', actorEmail: ACTOR_EMAIL, resend: true }),
        ).rejects.toMatchObject({
            response: { code: 'MEET71_DENIED' },
            status: 403,
        });
        expect(db.meet71DenyEntry.delete).not.toHaveBeenCalled();
        expect(db.meet71DenyEntry.deleteMany).not.toHaveBeenCalled();
        expect(email.sendMeet71Invite).not.toHaveBeenCalled();
        expect(db.meet71Member.update).not.toHaveBeenCalled();
    });

    it('resend of existing member does not increment invites_used', async () => {
        members['member@erp71.com'] = {
            email: 'member@erp71.com',
            can_create_room: false,
            invite_quota: 0,
            invites_used: 0,
        };

        const result = await service.invite({
            email: 'Member@ERP71.com',
            actorEmail: ACTOR_EMAIL,
            resend: true,
        });

        expect(result).toEqual({
            email: 'member@erp71.com',
            invitesRemaining: 3,
            emailSent: true,
            resent: true,
        });
        expect(actor.invites_used).toBe(2);
        expect(db.meet71Member.update).not.toHaveBeenCalled();
        expect(db.meet71Member.create).not.toHaveBeenCalled();
        expect(email.sendMeet71Invite).toHaveBeenCalledWith('member@erp71.com', 'Actor');
    });

    it('already member without resend is 409', async () => {
        members['member@erp71.com'] = {
            email: 'member@erp71.com',
            can_create_room: false,
            invite_quota: 0,
            invites_used: 0,
        };

        await expect(
            service.invite({ email: 'member@erp71.com', actorEmail: ACTOR_EMAIL }),
        ).rejects.toMatchObject({
            response: { code: 'MEET71_ALREADY_MEMBER' },
            status: 409,
        });
        expect(email.sendMeet71Invite).not.toHaveBeenCalled();
        expect(db.meet71Member.update).not.toHaveBeenCalled();
        expect(db.meet71Member.create).not.toHaveBeenCalled();
    });

    it('at cap is 403 MEET71_INVITE_CAP', async () => {
        actor.invite_quota = 2;
        actor.invites_used = 2;

        await expect(
            service.invite({ email: 'new@erp71.com', actorEmail: ACTOR_EMAIL }),
        ).rejects.toMatchObject({
            response: { code: 'MEET71_INVITE_CAP' },
            status: 403,
        });
        expect(db.meet71Member.create).not.toHaveBeenCalled();
        expect(email.sendMeet71Invite).not.toHaveBeenCalled();
        expect(db.meet71Member.update).not.toHaveBeenCalled();
    });

    it('console unlimited invites with actor quota 0 succeeds', async () => {
        actor.invite_quota = 0;
        actor.invites_used = 0;

        const result = await service.invite({
            email: 'new@erp71.com',
            actorEmail: ACTOR_EMAIL,
            unlimited: true,
        });

        expect(result).toEqual({
            email: 'new@erp71.com',
            invitesRemaining: 0,
            emailSent: true,
        });
        expect(db.meet71Member.create).toHaveBeenCalled();
        expect(email.sendMeet71Invite).toHaveBeenCalledWith('new@erp71.com', 'Actor');
        expect(db.meet71Member.update).not.toHaveBeenCalled();
        expect(actor.invites_used).toBe(0);
    });

    it('happy path inserts member can_create_room false and decrements remaining', async () => {
        const result = await service.invite({
            email: 'New@ERP71.com',
            actorEmail: 'Actor@ERP71.com',
        });

        const sql = db.$queryRaw.mock.calls[0][0].join(' ');
        expect(sql).toContain('FOR UPDATE');
        expect(db.meet71AllowEntry.upsert).toHaveBeenCalledWith({
            where: { pattern: 'new@erp71.com' },
            create: { pattern: 'new@erp71.com', kind: 'EMAIL', created_by: ACTOR_EMAIL },
            update: {},
        });
        expect(db.meet71Member.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                email: 'new@erp71.com',
                can_create_room: false,
                invite_quota: 0,
                is_admin: false,
            }),
        });
        expect(db.meet71Member.update).toHaveBeenCalledWith({
            where: { email: ACTOR_EMAIL },
            data: { invites_used: { increment: 1 } },
        });
        expect(result).toEqual({
            email: 'new@erp71.com',
            invitesRemaining: 2,
            emailSent: true,
        });
        expect(email.sendMeet71Invite).toHaveBeenCalledWith('new@erp71.com', 'Actor');
        expect(actor.invites_used).toBe(3);
    });
});
