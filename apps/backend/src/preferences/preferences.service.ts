import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
    LEGACY_BROWSER_SECTIONS,
    PERSON_SECTIONS,
    normalizeInvoicePrintPrefsPartial,
    normalizeMemberPreferences,
    normalizeProfilePrefs,
    normalizeSectionPartial,
    resolvePreferences,
    sanitizeTableView,
    type AlertPrefs,
    type LegacyBrowserSection,
    type MemberPreferences,
    type MyPreferencesResponse,
    type PersonSectionKey,
    type PreferenceProfilePrefs,
    type SectionPartials,
} from '@erp71/shared-types';
import { ALERT_TYPE_CODES } from '../alerts/alert-types';
import { DatabaseService } from '../database/database.service';

type Client = Prisma.TransactionClient;
type ResolvedSection = MyPreferencesResponse['sections'][PersonSectionKey];

/** The sections that live inside `TenantUser.preferences`; invoice layout and alerts have a store of their own. */
const JSON_SECTIONS = ['tableView', 'tableColumns', 'sidebar'] as const;
type JsonSection = (typeof JSON_SECTIONS)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isJsonSection(key: PersonSectionKey): key is JsonSection {
    return (JSON_SECTIONS as readonly string[]).includes(key);
}

function hasAnswers(value: object | undefined): boolean {
    return !!value && Object.keys(value).length > 0;
}

/** A member who has answered nothing goes back to a null column, not an empty blob. */
function storable(prefs: MemberPreferences): Prisma.InputJsonValue | typeof Prisma.DbNull {
    return Object.keys(prefs).length > 1 ? (prefs as unknown as Prisma.InputJsonValue) : Prisma.DbNull;
}

@Injectable()
export class PreferencesService {
    constructor(private readonly db: DatabaseService) {}

    /**
     * The profile that applies to a member: their primary role's, else the
     * workspace default, else none. `prefs` is normalised, so a hand-edited row
     * cannot hand a caller a shape it does not expect.
     */
    async profileFor(
        tenantId: string,
        userId: string,
    ): Promise<{ id: string; name: string; prefs: PreferenceProfilePrefs } | null> {
        return (await this.read(this.db, tenantId, userId)).profile;
    }

    /** What the member sees, section by section, and where each value came from. */
    async resolveFor(tenantId: string, userId: string): Promise<MyPreferencesResponse> {
        return (await this.read(this.db, tenantId, userId)).response;
    }

    /**
     * Stores the member's change to one section and returns what that section
     * now resolves to. Only the submitted fields are written onto the member's
     * own layer: writing the resolved value back would freeze today's profile
     * (or built-ins) into the member's answers and hide later profile changes.
     */
    async saveSection(
        tenantId: string,
        userId: string,
        key: PersonSectionKey,
        body: unknown,
    ): Promise<ResolvedSection> {
        this.assertPersonSection(key);
        if (!isRecord(body)) throw new BadRequestException('Send the preference as an object.');
        if (key === 'sidebar' && !Array.isArray(body.appShellOpenGroups)) {
            throw new BadRequestException('appShellOpenGroups must be a list.');
        }

        return this.db.$transaction(async (tx) => {
            await this.lock(tx, tenantId, userId);
            const { member, response } = await this.read(tx, tenantId, userId);
            const stored = normalizeMemberPreferences(member.preferences);

            if (key === 'invoicePrint') {
                const next = {
                    ...normalizeInvoicePrintPrefsPartial(member.invoice_print_prefs),
                    ...normalizeInvoicePrintPrefsPartial(body),
                };
                await tx.tenantUser.update({
                    where: this.membership(tenantId, userId),
                    data: { invoice_print_prefs: next as Prisma.InputJsonValue },
                });
            } else if (key === 'alerts') {
                const incoming = normalizeSectionPartial('alerts', body);
                // Start from what the member sees now. The row is always a whole answer, so
                // saving one field must not turn the profile's other fields back into built-ins.
                const base = response.sections.alerts.value;
                const next: AlertPrefs = {
                    mutedTypes: (incoming.mutedTypes ?? base.mutedTypes).filter((type) =>
                        ALERT_TYPE_CODES.includes(type),
                    ),
                    quiet: { ...base.quiet, ...incoming.quiet },
                };
                const row = {
                    muted_types: next.mutedTypes,
                    quiet_enabled: next.quiet.enabled,
                    quiet_from: next.quiet.from,
                    quiet_to: next.quiet.to,
                };
                await tx.userAlertPreference.upsert({
                    where: { user_id_tenant_id: { user_id: userId, tenant_id: tenantId } },
                    create: { user_id: userId, tenant_id: tenantId, ...row },
                    update: row,
                });
            } else {
                const value = this.mergeJsonSection(key, stored, body);
                const next: Record<string, unknown> = { ...stored, version: 1 };
                if (hasAnswers(value)) next[key] = value;
                else delete next[key];
                await tx.tenantUser.update({
                    where: this.membership(tenantId, userId),
                    data: {
                        preferences: storable(next as unknown as MemberPreferences),
                        // The member has answered, so the browser's old value stops counting.
                        legacy_browser_sections: this.legacyList(member.legacy_browser_sections).filter(
                            (section) => section !== key,
                        ),
                    },
                });
            }

            return (await this.read(tx, tenantId, userId)).response.sections[key];
        });
    }

    /** Drops the member's own answer, so the section falls back to the profile or built-in. */
    async resetSection(tenantId: string, userId: string, key: PersonSectionKey): Promise<ResolvedSection> {
        this.assertPersonSection(key);
        return this.db.$transaction(async (tx) => {
            await this.lock(tx, tenantId, userId);
            const touched = await this.clearSections(tx, tenantId, [userId], [key]);
            if (touched === 0) throw new NotFoundException('Not a member of this workspace.');
            return (await this.read(tx, tenantId, userId)).response.sections[key];
        });
    }

    /**
     * Removes the listed sections from the answers of the listed members of one
     * workspace and returns how many memberships were looked at. Shared by a
     * member's own reset and by a profile "apply to everyone", so the two cannot
     * disagree about what "no answer" means: a null invoice layout, no alert row,
     * the key gone from `preferences`, and the section off the legacy-browser list
     * (a reset member must see the profile, not the shared till's leftovers).
     * Callers hold the transaction; `userIds` are matched on `tenant_id` too, so a
     * foreign id is simply not found.
     */
    async clearSections(
        tx: Client,
        tenantId: string,
        userIds: string[],
        sections: PersonSectionKey[],
    ): Promise<number> {
        if (userIds.length === 0 || sections.length === 0) return 0;
        const where = { tenant_id: tenantId, user_id: { in: userIds } };

        const members = await tx.tenantUser.findMany({
            where,
            select: { user_id: true, preferences: true, legacy_browser_sections: true },
        });

        if (sections.includes('invoicePrint')) {
            await tx.tenantUser.updateMany({ where, data: { invoice_print_prefs: Prisma.DbNull } });
        }
        if (sections.includes('alerts')) {
            await tx.userAlertPreference.deleteMany({ where });
        }

        const jsonSections = sections.filter(isJsonSection);
        if (jsonSections.length > 0) {
            for (const member of members) {
                const stored = normalizeMemberPreferences(member.preferences);
                const legacy = this.legacyList(member.legacy_browser_sections);
                const holdsAnswer = jsonSections.some((section) => section in stored);
                const holdsLegacy = legacy.some((section) => (jsonSections as string[]).includes(section));
                // Untouched members are not written to: "apply" may run over thousands.
                if (!holdsAnswer && !holdsLegacy) continue;

                const next: Record<string, unknown> = { ...stored };
                for (const section of jsonSections) delete next[section];
                await tx.tenantUser.update({
                    where: this.membership(tenantId, member.user_id),
                    data: {
                        preferences: storable(next as unknown as MemberPreferences),
                        legacy_browser_sections: legacy.filter(
                            (section) => !(jsonSections as string[]).includes(section),
                        ),
                    },
                });
            }
        }
        return members.length;
    }

    // ---------------------------------------------------------------------

    /** Applies the submitted fields to the member's stored layer for one JSON-held section. */
    private mergeJsonSection(key: JsonSection, stored: MemberPreferences, body: Record<string, unknown>): object {
        switch (key) {
            case 'tableView': {
                const current = stored.tableView ?? {};
                const global = { ...current.global, ...(isRecord(body.global) ? sanitizeTableView(body.global) : {}) };
                // A list's override is one decision: the submitted entry replaces it whole.
                const tables = { ...current.tables };
                if (isRecord(body.tables)) {
                    for (const [id, entry] of Object.entries(body.tables)) {
                        if (entry === null) {
                            delete tables[id];
                            continue;
                        }
                        // Normalised alone so an invalid id or entry is skipped, not stored.
                        const clean = normalizeSectionPartial('tableView', { tables: { [id]: entry } }).tables?.[id];
                        if (clean) tables[id] = clean;
                    }
                }
                return normalizeSectionPartial('tableView', { global, tables });
            }
            case 'tableColumns': {
                const columns = { ...stored.tableColumns };
                for (const [id, entry] of Object.entries(body)) {
                    if (entry === null) {
                        delete columns[id];
                        continue;
                    }
                    const clean = normalizeSectionPartial('tableColumns', { [id]: entry })[id];
                    if (clean) columns[id] = clean;
                }
                // Once more as a whole, so the limit on lists applies to what is stored.
                return normalizeSectionPartial('tableColumns', columns);
            }
            case 'sidebar':
                return normalizeSectionPartial('sidebar', body);
        }
    }

    private assertPersonSection(key: string): asserts key is PersonSectionKey {
        if (!(PERSON_SECTIONS as readonly string[]).includes(key)) {
            throw new BadRequestException(`"${key}" is not a preference a member can save.`);
        }
    }

    private membership(tenantId: string, userId: string) {
        return { tenant_id_user_id: { tenant_id: tenantId, user_id: userId } };
    }

    /**
     * Serialises writers of one membership, so two devices saving different
     * sections each keep the other's change (the prefs blob is read, changed and
     * written whole). Same pattern as `PaymentMethodsService.writeLayout`.
     */
    private async lock(tx: Client, tenantId: string, userId: string): Promise<void> {
        await tx.$queryRaw`SELECT 1 FROM "TenantUser" WHERE tenant_id = ${tenantId} AND user_id = ${userId} FOR UPDATE`;
    }

    private legacyList(raw: string[] | null | undefined): LegacyBrowserSection[] {
        return (raw ?? []).filter((section): section is LegacyBrowserSection =>
            (LEGACY_BROWSER_SECTIONS as readonly string[]).includes(section),
        );
    }

    /** Loads everything one resolution needs, and resolves it. */
    private async read(client: Client, tenantId: string, userId: string) {
        const member = await client.tenantUser.findUnique({
            where: this.membership(tenantId, userId),
            select: {
                invoice_print_prefs: true,
                preferences: true,
                legacy_browser_sections: true,
                tenantRole: { select: { preferenceProfile: true } },
            },
        });
        if (!member) throw new NotFoundException('Not a member of this workspace.');

        const row =
            member.tenantRole?.preferenceProfile ??
            (await client.preferenceProfile.findFirst({ where: { tenant_id: tenantId, is_default: true } }));
        const profile = row ? { id: row.id, name: row.name, prefs: normalizeProfilePrefs(row.prefs) } : null;

        const alertRow = await client.userAlertPreference.findUnique({
            where: { user_id_tenant_id: { user_id: userId, tenant_id: tenantId } },
        });

        // The row is the member's whole answer for alerts, not a layer to merge fields from.
        const { version: _version, ...own } = normalizeMemberPreferences(member.preferences);
        const memberLayer: SectionPartials = { ...own };
        const invoicePrint = normalizeInvoicePrintPrefsPartial(member.invoice_print_prefs);
        if (hasAnswers(invoicePrint)) memberLayer.invoicePrint = invoicePrint;
        if (alertRow) {
            memberLayer.alerts = {
                mutedTypes: alertRow.muted_types,
                quiet: { enabled: alertRow.quiet_enabled, from: alertRow.quiet_from, to: alertRow.quiet_to },
            };
        }

        const response: MyPreferencesResponse = {
            profile: profile && { id: profile.id, name: profile.name },
            legacy_browser_sections: this.legacyList(member.legacy_browser_sections),
            // Browser-held values are the browser's to supply; the server only says which sections still count them.
            sections: resolvePreferences({ profile: profile?.prefs, member: memberLayer }),
        };
        return { member, profile, response };
    }
}
