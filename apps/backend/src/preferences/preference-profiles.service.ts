import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
    PERSON_SECTIONS,
    PREFERENCE_SECTIONS,
    normalizeProfilePrefs,
    normalizeSectionPartial,
    type PersonSectionKey,
    type PreferenceProfileDetail,
    type PreferenceProfileSummary,
    type SectionPartials,
} from '@erp71/shared-types';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../database/database.service';
import { TenantContext } from '../database/tenant.decorator';
import {
    ApplyPreferenceProfileDto,
    CreatePreferenceProfileDto,
    UpdatePreferenceProfileDto,
} from './preference-profiles.dto';
import { PreferencesService } from './preferences.service';

const WITH_ROLES = { roles: { select: { id: true, name: true }, orderBy: { name: 'asc' } } } as const;

type ProfileRow = Prisma.PreferenceProfileGetPayload<{ include: typeof WITH_ROLES }>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isDuplicate(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

@Injectable()
export class PreferenceProfilesService {
    constructor(
        private readonly db: DatabaseService,
        private readonly preferences: PreferencesService,
        private readonly audit: AuditService,
    ) {}

    async list(tenantId: string): Promise<PreferenceProfileSummary[]> {
        const rows = await this.db.preferenceProfile.findMany({
            where: { tenant_id: tenantId },
            include: WITH_ROLES,
            orderBy: { name: 'asc' },
        });
        return rows.map((row) => this.summary(row));
    }

    async get(tenantId: string, id: string): Promise<PreferenceProfileDetail> {
        return this.detail(await this.find(tenantId, id));
    }

    async create(ctx: TenantContext, dto: CreatePreferenceProfileDto): Promise<PreferenceProfileDetail> {
        const name = this.cleanName(dto.name);
        const prefs = normalizeProfilePrefs({ sections: isRecord(dto.sections) ? dto.sections : {} });

        let row: ProfileRow;
        try {
            row = await this.db.$transaction(async (tx) => {
                if (dto.is_default) await this.clearDefault(tx, ctx.tenantId);
                return tx.preferenceProfile.create({
                    data: {
                        tenant_id: ctx.tenantId,
                        name,
                        is_default: dto.is_default ?? false,
                        prefs: prefs as unknown as Prisma.InputJsonValue,
                        updated_by: ctx.userId,
                    },
                    include: WITH_ROLES,
                });
            });
        } catch (error) {
            throw this.translate(error);
        }

        await this.audit.log('PREFERENCE_PROFILE_CREATED', 'PreferenceProfile', this.auditCtx(ctx), row.id, {
            name,
            is_default: row.is_default,
        });
        return this.detail(row);
    }

    async update(ctx: TenantContext, id: string, dto: UpdatePreferenceProfileDto): Promise<PreferenceProfileDetail> {
        const existing = await this.find(ctx.tenantId, id);
        const name = dto.name !== undefined ? this.cleanName(dto.name) : undefined;

        const data: Prisma.PreferenceProfileUpdateInput = { updated_by: ctx.userId };
        if (name !== undefined) data.name = name;
        if (dto.is_default !== undefined) data.is_default = dto.is_default;
        if (isRecord(dto.sections)) {
            const merged: Record<string, unknown> = { ...normalizeProfilePrefs(existing.prefs).sections };
            for (const key of PREFERENCE_SECTIONS) {
                if (!(key in dto.sections)) continue;
                const value = dto.sections[key];
                if (value === null) delete merged[key];
                else merged[key] = normalizeSectionPartial(key, value);
            }
            data.prefs = normalizeProfilePrefs({ sections: merged }) as unknown as Prisma.InputJsonValue;
        }

        let row: ProfileRow;
        try {
            row = await this.db.$transaction(async (tx) => {
                if (dto.is_default) await this.clearDefault(tx, ctx.tenantId, id);
                return tx.preferenceProfile.update({ where: { id }, data, include: WITH_ROLES });
            });
        } catch (error) {
            throw this.translate(error);
        }

        await this.audit.log('PREFERENCE_PROFILE_UPDATED', 'PreferenceProfile', this.auditCtx(ctx), id, {
            name: row.name,
            is_default: row.is_default,
            changed: Object.keys(dto).filter((key) => (dto as Record<string, unknown>)[key] !== undefined),
        });
        return this.detail(row);
    }

    /** Roles that pointed at the profile fall back to the default one (the foreign key is SetNull). */
    async remove(ctx: TenantContext, id: string): Promise<{ success: true }> {
        const existing = await this.find(ctx.tenantId, id);
        await this.db.preferenceProfile.delete({ where: { id } });
        await this.audit.log('PREFERENCE_PROFILE_DELETED', 'PreferenceProfile', this.auditCtx(ctx), id, {
            name: existing.name,
        });
        return { success: true };
    }

    /**
     * Discards the chosen sections of the targeted members' own answers so the
     * profile shows through. Without `user_ids` the targets are the members the
     * profile currently reaches (never the caller); with them, exactly those
     * that belong to this workspace.
     */
    async apply(ctx: TenantContext, id: string, dto: ApplyPreferenceProfileDto): Promise<{ updated: number }> {
        const sections = this.personSections(dto.sections);
        const profile = await this.find(ctx.tenantId, id);

        const requested = dto.user_ids ? [...new Set(dto.user_ids)] : undefined;
        const { updated, userIds } = await this.db.$transaction(async (tx) => {
            const targets = await tx.tenantUser.findMany({
                where: requested
                    ? { tenant_id: ctx.tenantId, user_id: { in: requested } }
                    : {
                          tenant_id: ctx.tenantId,
                          user_id: { not: ctx.userId },
                          OR: [
                              { tenantRole: { preference_profile_id: id } },
                              ...(profile.is_default
                                  ? [{ tenant_role_id: null }, { tenantRole: { preference_profile_id: null } }]
                                  : []),
                          ],
                      },
                select: { user_id: true },
            });
            const ids = targets.map((target) => target.user_id);
            return { updated: await this.preferences.clearSections(tx, ctx.tenantId, ids, sections), userIds: ids };
        });

        await this.audit.log('PREFERENCE_PROFILE_APPLIED', 'PreferenceProfile', this.auditCtx(ctx), id, {
            user_ids: userIds,
            sections,
        });
        return { updated };
    }

    // ---------------------------------------------------------------------

    private async find(tenantId: string, id: string): Promise<ProfileRow> {
        const row = await this.db.preferenceProfile.findFirst({
            where: { id, tenant_id: tenantId },
            include: WITH_ROLES,
        });
        if (!row) throw new NotFoundException('Preference profile not found.');
        return row;
    }

    /** At most one default per workspace; the caller holds the transaction. */
    private async clearDefault(tx: Prisma.TransactionClient, tenantId: string, exceptId?: string): Promise<void> {
        await tx.preferenceProfile.updateMany({
            where: { tenant_id: tenantId, is_default: true, ...(exceptId ? { id: { not: exceptId } } : {}) },
            data: { is_default: false },
        });
    }

    private cleanName(raw: unknown): string {
        const name = typeof raw === 'string' ? raw.trim() : '';
        if (name.length < 1 || name.length > 60) {
            throw new BadRequestException('Profile name must be 1 to 60 characters.');
        }
        return name;
    }

    private personSections(raw: unknown): PersonSectionKey[] {
        if (!Array.isArray(raw) || raw.length === 0) {
            throw new BadRequestException('Choose at least one section to apply.');
        }
        const known = PERSON_SECTIONS as readonly string[];
        const bad = raw.filter((section) => typeof section !== 'string' || !known.includes(section));
        if (bad.length > 0) throw new BadRequestException(`Cannot apply section "${String(bad[0])}".`);
        return [...new Set(raw as PersonSectionKey[])];
    }

    private translate(error: unknown): unknown {
        return isDuplicate(error) ? new ConflictException('A profile with this name already exists.') : error;
    }

    private auditCtx(ctx: TenantContext) {
        return { userId: ctx.userId, tenantId: ctx.tenantId };
    }

    private summary(row: ProfileRow): PreferenceProfileSummary {
        return {
            id: row.id,
            name: row.name,
            is_default: row.is_default,
            roles: row.roles.map((role) => ({ id: role.id, name: role.name })),
            updated_at: row.updated_at.toISOString(),
        };
    }

    private detail(row: ProfileRow): PreferenceProfileDetail {
        const sections: SectionPartials = normalizeProfilePrefs(row.prefs).sections;
        return { ...this.summary(row), sections };
    }
}
