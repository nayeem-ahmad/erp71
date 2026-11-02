import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
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

export type Meet71Actor = { userId?: string; email?: string | null };

export type Meet71AllowlistView = {
    id: string;
    pattern: string;
    kind: string;
    createdBy: string | null;
    createdAt: Date;
};

export type Meet71MemberView = {
    email: string;
    displayName: string | null;
    isAdmin: boolean;
    canCreateRoom: boolean;
    inviteQuota: number;
    invitesUsed: number;
    invitesRemaining: number;
};

export type Meet71DenialView = {
    email: string;
    createdBy: string | null;
    createdAt: Date;
};

export type Meet71RoomView = {
    code: string;
    createdByEmail: string;
    createdAt: Date;
    coHostEmails: string[];
};

export type Meet71RoomPatch = {
    createdByEmail?: string;
    coHostEmails?: string[];
};

const MAX_CO_HOSTS = 10;

type MemberRow = {
    display_name: string | null;
    is_admin: boolean;
    can_create_room: boolean;
    invite_quota: number;
    invites_used: number;
};

type AllowRow = {
    id: string;
    pattern: string;
    kind: string;
    created_by: string | null;
    created_at: Date;
};

@Injectable()
export class Meet71MembershipService {
    constructor(
        private db: DatabaseService,
        private audit: AuditService,
    ) {}

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

    async listAdmin(): Promise<{
        entries: Meet71AllowlistView[];
        members: Meet71MemberView[];
        denials: Meet71DenialView[];
        rooms: Meet71RoomView[];
    }> {
        const [entries, members, denials, rooms] = await Promise.all([
            this.db.meet71AllowEntry.findMany({ orderBy: { created_at: 'asc' } }),
            this.db.meet71Member.findMany({ orderBy: { email: 'asc' } }),
            this.db.meet71DenyEntry.findMany({ orderBy: { created_at: 'asc' } }),
            this.db.meet71Room.findMany({
                orderBy: { created_at: 'desc' },
                take: 100,
                include: { hosts: true },
            }),
        ]);
        return {
            entries: entries.map((row) => this.toAllowEntry(row)),
            members: members.map((row) => this.toMemberView(row.email, row)),
            denials: denials.map((row) => ({
                email: row.email,
                createdBy: row.created_by,
                createdAt: row.created_at,
            })),
            rooms: rooms.map((row) => this.toRoomView(row)),
        };
    }

    async addAllowlist(patternRaw: string, actor: Meet71Actor): Promise<Meet71AllowlistView> {
        const parsed = parseAllowPattern(patternRaw);
        if (parsed.kind === 'EMAIL') {
            const deny = await this.db.meet71DenyEntry.findUnique({ where: { email: parsed.pattern } });
            if (deny) {
                throw new ForbiddenException({
                    code: 'MEET71_DENIED',
                    message: 'This email is blocked on Meet71.',
                });
            }
        }

        const entry = await this.db.meet71AllowEntry.upsert({
            where: { pattern: parsed.pattern },
            create: {
                pattern: parsed.pattern,
                kind: parsed.kind,
                created_by: actor.email ?? null,
            },
            update: {},
        });

        if (parsed.kind === 'EMAIL') {
            await this.db.meet71Member.upsert({
                where: { email: parsed.pattern },
                create: {
                    email: parsed.pattern,
                    can_create_room: false,
                    invite_quota: 0,
                    is_admin: false,
                },
                update: {},
            });
        }

        await this.audit.log('MEET71_ALLOWLIST_ADD', 'Meet71AllowEntry', this.auditCtx(actor), entry.id, {
            pattern: entry.pattern,
            kind: parsed.kind,
            actorEmail: actor.email ?? null,
        });
        return this.toAllowEntry(entry);
    }

    async removeAllowlist(id: string, actor: Meet71Actor): Promise<void> {
        const existing = await this.db.meet71AllowEntry.findUnique({ where: { id } });
        if (!existing) throw new NotFoundException();
        await this.db.meet71AllowEntry.delete({ where: { id } });
        await this.audit.log('MEET71_ALLOWLIST_REMOVE', 'Meet71AllowEntry', this.auditCtx(actor), id, {
            pattern: existing.pattern,
            actorEmail: actor.email ?? null,
        });
    }

    async patchMember(
        email: string,
        patch: { canCreateRoom?: boolean; inviteQuota?: number; isAdmin?: boolean },
        actor: Meet71Actor,
    ): Promise<Meet71MemberView> {
        const e = normalizeEmail(email);
        const existing = await this.db.meet71Member.findUnique({ where: { email: e } });
        if (!existing) throw new NotFoundException();

        const data: { can_create_room?: boolean; invite_quota?: number; is_admin?: boolean } = {};
        if (patch.canCreateRoom !== undefined) data.can_create_room = patch.canCreateRoom;
        if (patch.inviteQuota !== undefined) data.invite_quota = patch.inviteQuota;
        if (patch.isAdmin !== undefined) data.is_admin = patch.isAdmin;

        const updated = await this.db.meet71Member.update({ where: { email: e }, data });
        await this.audit.log('MEET71_MEMBER_PATCH', 'Meet71Member', this.auditCtx(actor), e, {
            email: e,
            ...patch,
            actorEmail: actor.email ?? null,
        });
        return this.toMemberView(e, updated);
    }

    async deleteMember(email: string, actor: Meet71Actor): Promise<void> {
        const e = normalizeEmail(email);
        const deny = await this.db.$transaction(async (tx) => {
            await tx.meet71Member.deleteMany({ where: { email: e } });
            await tx.meet71AllowEntry.deleteMany({ where: { pattern: e } });
            const entries = await tx.meet71AllowEntry.findMany();
            const covering = entries.some((row) => this.matches(e, row.pattern));
            if (!covering) return null;
            return tx.meet71DenyEntry.upsert({
                where: { email: e },
                create: { email: e, created_by: actor.email ?? null },
                update: {},
            });
        });

        const ctx = this.auditCtx(actor);
        await this.audit.log('MEET71_MEMBER_DELETE', 'Meet71Member', ctx, e, {
            email: e,
            actorEmail: actor.email ?? null,
        });
        if (deny) {
            await this.audit.log('MEET71_DENY_ADD', 'Meet71DenyEntry', ctx, deny.id ?? e, {
                email: e,
                actorEmail: actor.email ?? null,
            });
        }
    }

    async removeDenial(email: string, actor: Meet71Actor): Promise<void> {
        const e = normalizeEmail(email);
        await this.db.meet71DenyEntry.deleteMany({ where: { email: e } });
        await this.audit.log('MEET71_DENY_REMOVE', 'Meet71DenyEntry', this.auditCtx(actor), e, {
            email: e,
            actorEmail: actor.email ?? null,
        });
    }

    async getRoom(code: string): Promise<Meet71RoomView> {
        const row = await this.db.meet71Room.findUnique({
            where: { code },
            include: { hosts: true },
        });
        if (!row) throw new NotFoundException();
        return this.toRoomView(row);
    }

    async patchRoom(code: string, patch: Meet71RoomPatch, actor: Meet71Actor): Promise<Meet71RoomView> {
        if (patch.createdByEmail === undefined && patch.coHostEmails === undefined) {
            throw new BadRequestException({
                code: 'MEET71_ROOM_PATCH_EMPTY',
                message: 'createdByEmail or coHostEmails is required',
            });
        }

        const existing = await this.db.meet71Room.findUnique({
            where: { code },
            include: { hosts: true },
        });
        if (!existing) throw new NotFoundException();

        const owner =
            patch.createdByEmail !== undefined
                ? patch.createdByEmail.trim().toLowerCase()
                : existing.created_by_email.trim().toLowerCase();

        const coHostEmails =
            patch.coHostEmails !== undefined
                ? normalizeCoHostEmails(patch.coHostEmails, owner)
                : uniqueEmails(existing.hosts.map((host) => host.email)).filter((email) => email !== owner);

        if (coHostEmails.length > MAX_CO_HOSTS) {
            throw new BadRequestException({
                code: 'MEET71_TOO_MANY_COHOSTS',
                message: `A room can have at most ${MAX_CO_HOSTS} co-hosts.`,
            });
        }

        const row = await this.db.$transaction(async (tx) => {
            const updated = await tx.meet71Room.update({
                where: { code },
                data: { created_by_email: owner },
            });
            await tx.meet71RoomHost.deleteMany({ where: { room_code: code } });
            if (coHostEmails.length) {
                await tx.meet71RoomHost.createMany({
                    data: coHostEmails.map((email) => ({ room_code: code, email })),
                });
            }
            return updated;
        });

        await this.audit.log('MEET71_ROOM_PATCH', 'Meet71Room', this.auditCtx(actor), row.id, {
            code: row.code,
            createdByEmail: owner,
            coHostEmails,
            actorEmail: actor.email ?? null,
        });
        return { code: row.code, createdByEmail: owner, createdAt: row.created_at, coHostEmails };
    }

    private async isAllowed(email: string): Promise<boolean> {
        const entries = await this.db.meet71AllowEntry.findMany();
        return entries.some((row) => this.matches(email, row.pattern));
    }

    private toMembership(email: string, member: MemberRow | null): Meet71Membership {
        return { allowed: true, ...this.toMemberView(email, member) };
    }

    private toMemberView(email: string, member: MemberRow | null): Meet71MemberView {
        const inviteQuota = member?.invite_quota ?? 0;
        const invitesUsed = member?.invites_used ?? 0;
        return {
            email,
            displayName: member?.display_name ?? null,
            isAdmin: member?.is_admin ?? false,
            canCreateRoom: member?.can_create_room ?? false,
            inviteQuota,
            invitesUsed,
            invitesRemaining: inviteQuota === -1 ? -1 : Math.max(0, inviteQuota - invitesUsed),
        };
    }

    private toRoomView(row: {
        code: string;
        created_by_email: string;
        created_at: Date;
        hosts?: { email: string }[];
    }): Meet71RoomView {
        const createdByEmail = row.created_by_email.trim().toLowerCase();
        return {
            code: row.code,
            createdByEmail,
            createdAt: row.created_at,
            coHostEmails: uniqueEmails((row.hosts ?? []).map((host) => host.email)).filter(
                (email) => email !== createdByEmail,
            ),
        };
    }

    private toAllowEntry(row: AllowRow): Meet71AllowlistView {
        return {
            id: row.id,
            pattern: row.pattern,
            kind: row.kind,
            createdBy: row.created_by,
            createdAt: row.created_at,
        };
    }

    private auditCtx(actor: Meet71Actor) {
        return { userId: actor.userId, tenantId: undefined };
    }
}

function normalizeEmail(value: string): string {
    try {
        return decodeURIComponent(value).trim().toLowerCase();
    } catch {
        return value.trim().toLowerCase();
    }
}

function uniqueEmails(values: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of values) {
        const email = raw.trim().toLowerCase();
        if (!email || seen.has(email)) continue;
        seen.add(email);
        out.push(email);
    }
    return out;
}

function normalizeCoHostEmails(values: string[], owner: string): string[] {
    return uniqueEmails(values).filter((email) => email !== owner);
}

function parseAllowPattern(raw: string): { pattern: string; kind: 'EMAIL' | 'DOMAIN' } {
    const pattern = raw.trim().toLowerCase();
    if (!pattern) {
        throw new BadRequestException({ code: 'MEET71_INVALID_PATTERN', message: 'pattern is required' });
    }
    if (pattern.startsWith('@')) {
        if (pattern.length < 3) {
            throw new BadRequestException({ code: 'MEET71_INVALID_PATTERN', message: 'Invalid domain pattern' });
        }
        return { pattern, kind: 'DOMAIN' };
    }
    if (!pattern.includes('@')) {
        throw new BadRequestException({
            code: 'MEET71_INVALID_PATTERN',
            message: 'pattern must be an email or @domain',
        });
    }
    return { pattern, kind: 'EMAIL' };
}
