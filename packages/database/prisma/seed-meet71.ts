import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../.env') });

import { PrismaClient } from '@prisma/client';

/**
 * Meet71 bootstrap — the seeded admin and the two standing rooms.
 *
 * This runs on every production container start (db-prepare.sh, next to
 * `db:seed:platform`). It must never reset invite caps or re-own rooms an
 * admin has reassigned — putting that in `seed-platform.ts` would be the
 * same class of bug that used to reset the super-admin password.
 *
 * Create-only: an existing member keeps `invite_quota` / `invites_used`;
 * an existing room keeps `created_by_email`. The update branch only
 * re-asserts `is_admin` and `can_create_room` on the bootstrap email so
 * that flag cannot be lowered by a later deploy.
 *
 * Use exactly `nayeem.ahmad@gmail.com` (one 'h' in Ahmad).
 */

const ADMIN_EMAIL = 'nayeem.ahmad@gmail.com';
const ADMIN_DISPLAY_NAME = 'Nayeem Ahmad';
const STANDING_ROOM_CODES = ['otb', 'ishraak'] as const;

export async function seedMeet71(prisma: PrismaClient): Promise<void> {
    await prisma.meet71AllowEntry.upsert({
        where: { pattern: ADMIN_EMAIL },
        create: { pattern: ADMIN_EMAIL, kind: 'EMAIL' },
        update: {},
    });

    const user = await prisma.user.findUnique({
        where: { email: ADMIN_EMAIL },
    });

    await prisma.meet71Member.upsert({
        where: { email: ADMIN_EMAIL },
        create: {
            email: ADMIN_EMAIL,
            display_name: ADMIN_DISPLAY_NAME,
            is_admin: true,
            can_create_room: true,
            invite_quota: -1,
            user_id: user?.id ?? null,
        },
        update: {
            is_admin: true,
            can_create_room: true,
        },
    });

    for (const code of STANDING_ROOM_CODES) {
        await prisma.meet71Room.upsert({
            where: { code },
            create: { code, created_by_email: ADMIN_EMAIL },
            update: {},
        });
    }
}

// Standalone entry point: `npm run db:seed:meet71`.
if (require.main === module) {
    const prisma = new PrismaClient();

    seedMeet71(prisma)
        .then(() => {
            console.log('✅  Meet71 membership seeded (admin + standing rooms)');
        })
        .catch((e) => {
            console.error(e);
            process.exit(1);
        })
        .finally(async () => {
            await prisma.$disconnect();
        });
}
