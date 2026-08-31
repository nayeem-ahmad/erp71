import { Transform } from 'class-transformer';
import { IsString, IsOptional, IsEnum, IsIn, IsUUID, IsEmail, IsDateString, IsObject, IsArray, ArrayNotEmpty, IsBoolean, IsInt, Max, Min } from 'class-validator';

// Define enums locally since Prisma enums aren't exported at runtime
export enum LeadStatus {
    NEW = 'NEW',
    CONTACTED = 'CONTACTED',
    QUALIFIED = 'QUALIFIED',
    LOST = 'LOST',
    CONVERTED = 'CONVERTED',
}

/** Stages a lead is still being worked in — the open pipeline. */
export const OPEN_LEAD_STATUSES = [
    LeadStatus.NEW,
    LeadStatus.CONTACTED,
    LeadStatus.QUALIFIED,
] as const;

/** True for the two terminal statuses, which are the ones that stamp `closed_at`. */
export function isClosedStatus(status: LeadStatus | string): boolean {
    return status === LeadStatus.CONVERTED || status === LeadStatus.LOST;
}

/**
 * `status` sentinel meaning "anything still in the open pipeline". A real status
 * is upper-case, so this cannot collide with one.
 *
 * Exists because the CRM dashboard's attention tiles count *open* leads, and
 * their "View all" links have to land on exactly the rows they counted — a
 * per-stage filter cannot express "NEW or CONTACTED or QUALIFIED".
 */
export const OPEN_LEAD_STATUS_FILTER = 'open';

/** A lead with no contact for this long is going cold. */
export const STALE_AFTER_DAYS = 14;

/** The instant before which a lead counts as neglected. */
export function staleLeadCutoff(days: number = STALE_AFTER_DAYS, now: Date = new Date()): Date {
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - days);
    return cutoff;
}

/**
 * Prisma fragment for "nobody has touched this lead since `cutoff`".
 *
 * Shared by the leads list filter and the CRM dashboard's stale tile so the two
 * cannot drift: the tile's count and the list its "View all" opens are the same
 * query. A bare `last_contacted_at: { lt: cutoff }` would be wrong on its own —
 * in SQL that EXCLUDES NULL, dropping every lead nobody has ever contacted,
 * which is the strongest neglect signal there is. The second branch falls back
 * to `created_at` so a lead filed this morning is not immediately flagged.
 */
export function staleLeadWhere(cutoff: Date) {
    return {
        OR: [
            { last_contacted_at: { lt: cutoff } },
            { last_contacted_at: null, created_at: { lt: cutoff } },
        ],
    };
}

export enum LeadPriority {
    LOW = 'LOW',
    MEDIUM = 'MEDIUM',
    HIGH = 'HIGH',
    URGENT = 'URGENT',
}

const emptyToUndefined = ({ value }: { value: unknown }) =>
    value === '' || value === null ? undefined : value;

/**
 * The counterpart to `emptyToUndefined`: `''` survives as an explicit `null`,
 * which `mapLeadData` writes to the column. Use it for a field the form shows
 * and therefore has to be able to *clear* — `undefined` means "leave alone",
 * which would make the control silently do nothing when emptied.
 *
 * `@IsOptional()` skips the type check for `null` as well as `undefined`, so a
 * nulled field still keeps its `@IsUUID()` / `@IsString()` guard on real values.
 */
const emptyToNull = ({ value }: { value: unknown }) =>
    value === '' || value === null ? null : value;

/**
 * Note on `source` / `category` across the DTOs below.
 *
 * They are tenant-managed rows in `LeadSourceOption` / `LeadCategoryOption`, not
 * enums, so there is no fixed set to validate against here. They accept a row
 * id, a `code`, or a display name, and are resolved — and rejected if unknown —
 * against the tenant's own rows in CrmLeadsService. That is stricter than the
 * `@IsEnum` check it replaces, not looser: it also verifies tenant ownership.
 *
 * They deliberately do NOT carry `@Transform(emptyToUndefined)`. An empty string
 * has to survive to the service as "clear this field", which is how a lead's
 * category gets removed; collapsing it to undefined would mean "leave alone" and
 * silently make the category unclearable.
 */
export class CreateLeadDto {
    @IsString()
    name: string;

    @IsOptional()
    @IsString()
    mobile?: string;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsEmail()
    email?: string;

    @IsOptional()
    @Transform(emptyToNull)
    @IsString()
    address?: string | null;

    @IsOptional()
    @IsString()
    category?: string;

    @IsOptional()
    @IsEnum(LeadPriority)
    priority?: LeadPriority;

    @IsOptional()
    @IsString()
    remarks?: string;

    @IsOptional()
    @IsString()
    source?: string;

    @IsOptional()
    @IsEnum(LeadStatus)
    status?: LeadStatus;

    @IsOptional()
    @IsString()
    lost_reason?: string;

    @IsOptional()
    @IsString()
    linkedin_url?: string;

    @IsOptional()
    @IsString()
    fb_url?: string;

    @IsOptional()
    @IsString()
    x_url?: string;

    @IsOptional()
    @IsString()
    website_url?: string;

    /**
     * Set from the photo picker, which uploads to `POST /crm/photos` first.
     * `''` clears the photo rather than meaning "leave it alone" — otherwise a
     * photo could never be removed once set.
     */
    @IsOptional()
    @IsString()
    photo_url?: string;

    @IsOptional()
    @IsString()
    photo_storage_key?: string;

    @IsOptional()
    @IsString()
    next_step?: string;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsDateString()
    next_step_date?: string;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsUUID()
    next_step_assigned_to?: string;

    /**
     * The lead's owner. Cleared with `''`/`null` (see `emptyToNull`) rather than
     * left alone, because the lead form's owner picker offers "Unassigned" — the
     * same clear the list's bulk assign has always supported.
     */
    @IsOptional()
    @Transform(emptyToNull)
    @IsUUID()
    assigned_to?: string | null;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsString()
    store_id?: string;

    @IsOptional()
    @IsObject()
    custom_fields?: Record<string, string>;
}

export class UpdateLeadDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    mobile?: string;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsEmail()
    email?: string;

    @IsOptional()
    @Transform(emptyToNull)
    @IsString()
    address?: string | null;

    @IsOptional()
    @IsString()
    category?: string;

    @IsOptional()
    @IsEnum(LeadPriority)
    priority?: LeadPriority;

    @IsOptional()
    @IsString()
    remarks?: string;

    @IsOptional()
    @IsString()
    source?: string;

    @IsOptional()
    @IsEnum(LeadStatus)
    status?: LeadStatus;

    @IsOptional()
    @IsString()
    lost_reason?: string;

    @IsOptional()
    @IsString()
    linkedin_url?: string;

    @IsOptional()
    @IsString()
    fb_url?: string;

    @IsOptional()
    @IsString()
    x_url?: string;

    @IsOptional()
    @IsString()
    website_url?: string;

    /**
     * Set from the photo picker, which uploads to `POST /crm/photos` first.
     * `''` clears the photo rather than meaning "leave it alone" — otherwise a
     * photo could never be removed once set.
     */
    @IsOptional()
    @IsString()
    photo_url?: string;

    @IsOptional()
    @IsString()
    photo_storage_key?: string;

    // `next_step` / `next_step_date` / `next_step_assigned_to` were dropped from
    // the update DTO in R1. They are a read-only rollup of the earliest PLANNED
    // CrmActivity now, written only by CrmActivitiesService.recalculateRollup —
    // reschedule through PATCH /crm/activities/:id instead. They survive on
    // CreateLeadDto only because a lead filed with an opening next step has no
    // activity to attach to yet, and create() materialises one from them.

    /**
     * The lead's owner. Cleared with `''`/`null` (see `emptyToNull`) rather than
     * left alone, because the lead form's owner picker offers "Unassigned" — the
     * same clear the list's bulk assign has always supported.
     */
    @IsOptional()
    @Transform(emptyToNull)
    @IsUUID()
    assigned_to?: string | null;

    @IsOptional()
    @IsObject()
    custom_fields?: Record<string, string>;
}

/**
 * Query params for GET /crm/leads.
 *
 * `status` and `priority` are still enum-validated, which matters more than it
 * looks: these previously arrived as raw strings and went straight into a Prisma
 * `where`, so a stale bookmarked filter (or a renamed value) returned a 500
 * instead of a 400. `source` and `category` are free strings because they now
 * hold tenant-defined row ids.
 */
/**
 * `assignedTo` sentinel meaning "leads nobody owns". A real owner is a UUID, so
 * this cannot collide with one. Needed because an empty `assignedTo` already
 * means "do not filter on owner" — without a sentinel the unowned leads (every
 * lead created before the owner field existed) are unreachable from the list.
 */
export const UNASSIGNED_OWNER_FILTER = 'unassigned';

/** Every value `status` accepts: a real stage, or the "open pipeline" sentinel. */
const LIST_STATUS_VALUES: string[] = [...Object.values(LeadStatus), OPEN_LEAD_STATUS_FILTER];

export class ListLeadsDto {
    // `@IsIn` rather than `@IsEnum`, because OPEN_LEAD_STATUS_FILTER is a valid
    // value here that is deliberately not a LeadStatus. Still rejects anything
    // else, which is the point of validating this at all.
    @IsOptional()
    @Transform(emptyToUndefined)
    @IsIn(LIST_STATUS_VALUES)
    status?: string;

    /**
     * "Nobody has touched this lead in N days" — the list-side half of the
     * dashboard's stale tile.
     *
     * A day count rather than a boolean so the number is always supplied by the
     * caller that also *displays* it: the tile links with the same
     * `stale_after_days` it rendered, and the list labels its toggle with the
     * number it queried. Neither side can claim one window and filter by another.
     *
     * Orthogonal to `status` — purely the time rule — so the tile's link pairs it
     * with `status=open` to land on exactly the rows it counted.
     */
    @IsOptional()
    @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
    @IsInt()
    @Min(1)
    // Ten years. Only a guard against a number large enough to overflow the
    // cutoff arithmetic into an Invalid Date; nothing legitimate goes near it.
    @Max(3650)
    staleDays?: number;

    @IsOptional()
    @IsString()
    source?: string;

    @IsOptional()
    @IsString()
    category?: string;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsEnum(LeadPriority)
    priority?: LeadPriority;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsString()
    assignedTo?: string;

    @IsOptional()
    @Transform(({ value }) => value === true || value === 'true' || value === '1')
    @IsBoolean()
    myActionsToday?: boolean;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsString()
    search?: string;

    @IsOptional()
    @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
    @IsInt()
    @Min(1)
    page?: number;

    @IsOptional()
    @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
    @IsInt()
    @Min(1)
    limit?: number;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsString()
    sortBy?: string;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsString()
    sortDir?: string;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsString()
    createdFrom?: string;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsString()
    createdTo?: string;
}

export enum LeadBulkAction {
    DELETE = 'delete',
    STATUS = 'status',
    ASSIGN = 'assign',
}

export class BulkLeadActionDto {
    @IsArray()
    @ArrayNotEmpty()
    @IsString({ each: true })
    ids: string[];

    @IsEnum(LeadBulkAction)
    action: LeadBulkAction;

    @IsOptional()
    @IsString()
    value?: string;
}