import { seedMeet71 } from '../../../packages/database/prisma/seed-meet71';

/**
 * `db:seed:meet71` runs on every production container start, next to
 * `db:seed:platform`. It must never reset invite caps or re-own standing
 * rooms an admin has reassigned — the same class of bug that used to reset
 * the super-admin password.
 */
const ADMIN_EMAIL = 'nayeem.ahmad@gmail.com';
const TYPO_EMAIL = 'nayeem.ahammad@gmail.com';

type Row = Record<string, unknown>;

function fakePrisma() {
    const allow = new Map<string, Row>();
    const members = new Map<string, Row>();
    const rooms = new Map<string, Row>();
    const users: Array<{ id: string; email: string }> = [];

    return {
        user: {
            findUnique: jest.fn(({ where }: { where: { email: string } }) =>
                Promise.resolve(users.find((u) => u.email === where.email) ?? null),
            ),
        },
        meet71AllowEntry: {
            upsert: jest.fn(async ({ where, create, update }: { where: { pattern: string }; create: Row; update: Row }) => {
                const existing = allow.get(where.pattern);
                if (existing) {
                    Object.assign(existing, update);
                    return existing;
                }
                const row = { ...create };
                allow.set(String(create.pattern), row);
                return row;
            }),
            findMany: jest.fn(async () => [...allow.values()]),
        },
        meet71Member: {
            upsert: jest.fn(async ({ where, create, update }: { where: { email: string }; create: Row; update: Row }) => {
                const existing = members.get(where.email);
                if (existing) {
                    Object.assign(existing, update);
                    return existing;
                }
                const row = { invites_used: 0, ...create };
                members.set(String(create.email), row);
                return row;
            }),
            findUnique: jest.fn(async ({ where }: { where: { email: string } }) => members.get(where.email) ?? null),
            update: jest.fn(async ({ where, data }: { where: { email: string }; data: Row }) => {
                const row = members.get(where.email);
                if (!row) return null;
                Object.assign(row, data);
                return row;
            }),
            findMany: jest.fn(async () => [...members.values()]),
        },
        meet71Room: {
            upsert: jest.fn(async ({ where, create, update }: { where: { code: string }; create: Row; update: Row }) => {
                const existing = rooms.get(where.code);
                if (existing) {
                    Object.assign(existing, update);
                    return existing;
                }
                const row = { ...create };
                rooms.set(String(create.code), row);
                return row;
            }),
            findUnique: jest.fn(async ({ where }: { where: { code: string } }) => rooms.get(where.code) ?? null),
            update: jest.fn(async ({ where, data }: { where: { code: string }; data: Row }) => {
                const row = rooms.get(where.code);
                if (!row) return null;
                Object.assign(row, data);
                return row;
            }),
            findMany: jest.fn(async () => [...rooms.values()]),
        },
        _allow: allow,
        _members: members,
        _rooms: rooms,
        _users: users,
    };
}

describe('seedMeet71', () => {
    it('inserts nayeem.ahmad@gmail.com as admin with unlimited invites and create-room', async () => {
        const db = fakePrisma();
        await seedMeet71(db as never);

        const member = await db.meet71Member.findUnique({ where: { email: ADMIN_EMAIL } });
        expect(member).toEqual(
            expect.objectContaining({
                email: ADMIN_EMAIL,
                is_admin: true,
                can_create_room: true,
                invite_quota: -1,
            }),
        );

        const entries = await db.meet71AllowEntry.findMany();
        expect(entries).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ pattern: ADMIN_EMAIL, kind: 'EMAIL' }),
            ]),
        );
    });

    it('second run does not reset invite_quota or invites_used', async () => {
        const db = fakePrisma();
        await seedMeet71(db as never);

        await db.meet71Member.update({
            where: { email: ADMIN_EMAIL },
            data: { invite_quota: 3, invites_used: 1 },
        });

        await seedMeet71(db as never);

        const member = await db.meet71Member.findUnique({ where: { email: ADMIN_EMAIL } });
        expect(member?.invite_quota).toBe(3);
        expect(member?.invites_used).toBe(1);
        expect(member?.is_admin).toBe(true);
        expect(member?.can_create_room).toBe(true);
    });

    it('does not re-own standing rooms otb and ishraak', async () => {
        const db = fakePrisma();
        await seedMeet71(db as never);

        await db.meet71Room.update({ where: { code: 'otb' }, data: { created_by_email: 'other@x.com' } });
        await db.meet71Room.update({ where: { code: 'ishraak' }, data: { created_by_email: 'other@x.com' } });

        await seedMeet71(db as never);

        expect((await db.meet71Room.findUnique({ where: { code: 'otb' } }))?.created_by_email).toBe('other@x.com');
        expect((await db.meet71Room.findUnique({ where: { code: 'ishraak' } }))?.created_by_email).toBe('other@x.com');
    });

    it('never writes nayeem.ahammad@gmail.com', async () => {
        const db = fakePrisma();
        await seedMeet71(db as never);

        const dumped = JSON.stringify({
            allow: [...db._allow.values()],
            members: [...db._members.values()],
            rooms: [...db._rooms.values()],
            upserts: [
                ...db.meet71AllowEntry.upsert.mock.calls,
                ...db.meet71Member.upsert.mock.calls,
                ...db.meet71Room.upsert.mock.calls,
            ],
        });
        expect(dumped).not.toContain(TYPO_EMAIL);
        expect(dumped).toContain(ADMIN_EMAIL);
    });
});
