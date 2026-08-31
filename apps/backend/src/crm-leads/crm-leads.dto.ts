import { Transform } from 'class-transformer';
import { IsString, IsOptional, IsEnum, IsUUID, IsEmail, IsDateString, IsObject, IsArray, ArrayNotEmpty, IsBoolean, IsInt, Min } from 'class-validator';

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

/**
 * `emailPresence` filter for GET /crm/leads — "does this lead have an email at
 * all", not a match on its value (free-text `search` already covers that).
 *
 * EMPTY is the one people actually reach for: it lists the leads that no email
 * campaign can ever reach, so someone can go and collect the missing addresses.
 */
export enum LeadEmailPresence {
    HAS = 'has',
    EMPTY = 'empty',
}

export class ListLeadsDto {
    @IsOptional()
    @Transform(emptyToUndefined)
    @IsEnum(LeadStatus)
    status?: LeadStatus;

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
    @Transform(emptyToUndefined)
    @IsEnum(LeadEmailPresence)
    emailPresence?: LeadEmailPresence;

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