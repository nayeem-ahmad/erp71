import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { displayEmail } from '@erp71/shared-types';
import { DatabaseService } from '../database/database.service';
import type { AuditContext } from '../audit/audit.service';
import { EmployeesService } from './employees.service';
import {
    type LinkMatchReason,
    type MatchableUser,
    linkMatchReasons,
    rankByMatch,
    unambiguousPairs,
} from './employee-link-match.util';

/** People still on the books. A card that has left needs no login linked to it. */
const LINKABLE_STATUSES = ['ACTIVE', 'PROBATION'] as const;

/** Bulk linking is a cleanup pass, not an import: a page of pairs, confirmed by a person. */
export const MAX_BULK_LINKS = 200;

type MemberRow = { id: string; name: string | null; email: string; mobile: string | null };
type EmployeeRow = {
    id: string;
    employee_code: string;
    name: string;
    phone: string;
    email: string | null;
    status: string;
};

export interface LoginCandidate {
    userId: string;
    name: string | null;
    /** Null for a placeholder address — there is nothing worth showing. */
    email: string | null;
    mobile: string | null;
    matches: LinkMatchReason[];
}

export interface EmployeeCandidate {
    employeeId: string;
    employeeCode: string;
    name: string;
    phone: string;
    email: string | null;
    matches: LinkMatchReason[];
}

export interface BulkLinkResult {
    employeeId: string;
    userId: string;
    ok: boolean;
    error?: string;
}

/**
 * Finding which login belongs to which employee card, so HR never has to paste
 * a user id.
 *
 * Every list here is "not linked yet" on both sides: a login already attached
 * to an employee in this workspace is not offered again, and neither is a card
 * that already has one. The link itself is always `EmployeesService.linkUser`,
 * so auditing, hour stamping and cache invalidation live in one place.
 *
 * The member lists expose names, emails and mobile numbers of the workspace's
 * logins, which is why the routes need `MANAGE_USERS` as well as `MANAGE_HR`.
 */
@Injectable()
export class EmployeeLinkService {
    constructor(
        private readonly db: DatabaseService,
        private readonly employees: EmployeesService,
    ) {}

    /** Logins this employee could be linked to, likeliest first. */
    async loginCandidates(tenantId: string, employeeId: string, storeId?: string): Promise<LoginCandidate[]> {
        const employee = await this.db.employee.findFirst({
            where: { id: employeeId, tenant_id: tenantId, deleted_at: null, ...(storeId ? { store_id: storeId } : {}) },
            select: { id: true, name: true, phone: true, email: true },
        });
        if (!employee) throw new NotFoundException('Employee not found');

        const members = await this.unlinkedMembers(tenantId);
        return rankByMatch(
            members.map((user) => ({
                userId: user.id,
                name: user.name,
                email: displayEmail(user.email),
                mobile: user.mobile,
                matches: linkMatchReasons(employee, user),
                label: (user.name || user.email).toLowerCase(),
            })),
        ).map(({ label: _label, ...row }) => row);
    }

    /**
     * Employee cards a login could be linked to, likeliest first: for a member
     * on the Team page (`userId`), or for an address being invited (`email`).
     */
    async employeeCandidates(
        tenantId: string,
        whom: { userId?: string; email?: string },
        storeId?: string,
    ): Promise<EmployeeCandidate[]> {
        let likeness: MatchableUser = { mobile: null, email: whom.email ?? null, name: null };
        if (whom.userId) {
            const member = await this.db.tenantUser.findFirst({
                where: { tenant_id: tenantId, user_id: whom.userId },
                select: { user: { select: { id: true, name: true, email: true, mobile: true } } },
            });
            if (!member) throw new NotFoundException('That user is not part of this workspace.');
            likeness = member.user;
        }

        const cards = await this.unlinkedEmployees(tenantId, storeId);
        return rankByMatch(
            cards.map((card) => ({
                employeeId: card.id,
                employeeCode: card.employee_code,
                name: card.name,
                phone: card.phone,
                email: displayEmail(card.email),
                matches: linkMatchReasons(card, likeness),
                label: card.name.toLowerCase(),
            })),
        ).map(({ label: _label, ...row }) => row);
    }

    /**
     * Pairs a person can confirm in one pass: a strong match (mobile or email)
     * with no rival on either side. See `unambiguousPairs`.
     */
    async suggestions(tenantId: string, storeId?: string) {
        const [cards, members] = await Promise.all([
            this.unlinkedEmployees(tenantId, storeId),
            this.unlinkedMembers(tenantId),
        ]);
        return unambiguousPairs<EmployeeRow, MemberRow>(cards, members, linkMatchReasons).map(({ employee, user, matches }) => ({
            employee: {
                id: employee.id,
                employeeCode: employee.employee_code,
                name: employee.name,
                phone: employee.phone,
                email: displayEmail(employee.email),
            },
            user: { id: user.id, name: user.name, email: displayEmail(user.email), mobile: user.mobile },
            matches,
        }));
    }

    /**
     * Link each confirmed pair, one at a time. A pair that fails — someone
     * linked it by hand a moment ago, the card was deleted — is reported and
     * the rest still go ahead: refusing a whole page over one stale row would
     * send the person back to do the other 49 again.
     */
    async linkMany(
        tenantId: string,
        links: Array<{ employeeId: string; userId: string }>,
        storeId: string | undefined,
        ctx: AuditContext,
    ): Promise<{ linked: number; results: BulkLinkResult[] }> {
        if (links.length === 0) throw new BadRequestException('Choose at least one pair to link.');
        if (links.length > MAX_BULK_LINKS) {
            throw new BadRequestException(`Link at most ${MAX_BULK_LINKS} pairs at a time.`);
        }
        const employeeIds = new Set(links.map((link) => link.employeeId));
        const userIds = new Set(links.map((link) => link.userId));
        if (employeeIds.size !== links.length || userIds.size !== links.length) {
            throw new BadRequestException('Each employee and each login may appear only once.');
        }

        const results: BulkLinkResult[] = [];
        for (const link of links) {
            try {
                await this.employees.linkUser(tenantId, link.employeeId, link.userId, storeId, ctx);
                results.push({ ...link, ok: true });
            } catch (err: any) {
                results.push({ ...link, ok: false, error: err?.message ?? 'Could not link' });
            }
        }
        return { linked: results.filter((row) => row.ok).length, results };
    }

    /** Members of the workspace whose login no live employee card holds. */
    private async unlinkedMembers(tenantId: string): Promise<MemberRow[]> {
        const [members, linked] = await Promise.all([
            this.db.tenantUser.findMany({
                where: { tenant_id: tenantId },
                select: { user: { select: { id: true, name: true, email: true, mobile: true } } },
            }),
            this.db.employee.findMany({
                where: { tenant_id: tenantId, deleted_at: null, user_id: { not: null } },
                select: { user_id: true },
            }),
        ]);
        const taken = new Set(linked.map((row) => row.user_id));
        return members.map((row) => row.user).filter((user) => !taken.has(user.id));
    }

    /** Cards still on the books with no login, inside the caller's branch scope. */
    private async unlinkedEmployees(tenantId: string, storeId?: string): Promise<EmployeeRow[]> {
        return this.db.employee.findMany({
            where: {
                tenant_id: tenantId,
                deleted_at: null,
                user_id: null,
                status: { in: [...LINKABLE_STATUSES] },
                ...(storeId ? { store_id: storeId } : {}),
            },
            select: { id: true, employee_code: true, name: true, phone: true, email: true, status: true },
            orderBy: { name: 'asc' },
        });
    }
}
