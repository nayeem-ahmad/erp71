import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export type Meet71Membership =
    | { allowed: false }
    | {
          allowed: true;
          email: string;
          displayName: string | null;
          isAdmin: boolean;
          canCreateRoom: boolean;
          inviteQuota: number;
          invitesUsed: number;
          invitesRemaining: number;
      };

type MemberRow = {
    display_name: string | null;
    is_admin: boolean;
    can_create_room: boolean;
    invite_quota: number;
    invites_used: number;
};

@Injectable()
export class Meet71MembershipService {
    constructor(private db: DatabaseService) {}

    matches(email: string, pattern: string): boolean {
        const e = email.trim().toLowerCase();
        const a = pattern.trim().toLowerCase();
        return a.startsWith('@') ? e.endsWith(a) : e === a;
    }

    async evaluate(email: string): Promise<Meet71Membership> {
        const e = email.trim().toLowerCase();

        const deny = await this.db.meet71DenyEntry.findUnique({ where: { email: e } });
        if (deny) {
            return { allowed: false };
        }

        if (!(await this.isAllowed(e))) {
            return { allowed: false };
        }

        const member = await this.db.meet71Member.findUnique({ where: { email: e } });
        return this.toMembership(e, member);
    }

    async upsertOnSignIn(email: string, displayName: string | null): Promise<Meet71Membership> {
        const e = email.trim().toLowerCase();

        const deny = await this.db.meet71DenyEntry.findUnique({ where: { email: e } });
        if (deny) {
            return { allowed: false };
        }

        if (!(await this.isAllowed(e))) {
            return { allowed: false };
        }

        const existing = await this.db.meet71Member.findUnique({ where: { email: e } });
        if (!existing) {
            const created = await this.db.meet71Member.create({
                data: {
                    email: e,
                    display_name: displayName,
                    can_create_room: false,
                    invite_quota: 0,
                    is_admin: false,
                },
            });
            return this.toMembership(e, created);
        }

        if (displayName != null) {
            const updated = await this.db.meet71Member.update({
                where: { email: e },
                data: { display_name: displayName },
            });
            return this.toMembership(e, updated);
        }

        return this.toMembership(e, existing);
    }

    private async isAllowed(email: string): Promise<boolean> {
        const entries = await this.db.meet71AllowEntry.findMany();
        return entries.some((row) => this.matches(email, row.pattern));
    }

    private toMembership(email: string, member: MemberRow | null): Meet71Membership {
        const inviteQuota = member?.invite_quota ?? 0;
        const invitesUsed = member?.invites_used ?? 0;
        return {
            allowed: true,
            email,
            displayName: member?.display_name ?? null,
            isAdmin: member?.is_admin ?? false,
            canCreateRoom: member?.can_create_room ?? false,
            inviteQuota,
            invitesUsed,
            invitesRemaining: inviteQuota === -1 ? -1 : Math.max(0, inviteQuota - invitesUsed),
        };
    }
}
