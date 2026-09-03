import { IsArray, IsBoolean, IsEmail, IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { RefereePayoutMethod, RefereePayoutRequestStatus, ReferralCommissionStatus } from '@prisma/client';

const emptyToUndefined = ({ value }: { value: unknown }) =>
    value === '' || value === null ? undefined : value;

/**
 * Query strings arrive as text. These coerce before the @IsInt/@IsBoolean checks
 * run, and deliberately leave anything unrecognisable alone so it fails validation
 * rather than being silently reinterpreted — `?limit=abc` is a 400, not a default.
 */
const toInt = ({ value }: { value: unknown }) => {
    if (value === '' || value === null || value === undefined) return undefined;
    if (typeof value === 'number') return value;
    if (typeof value !== 'string') return value;
    return /^-?\d+$/.test(value.trim()) ? Number(value.trim()) : value;
};

const toBoolean = ({ value }: { value: unknown }) => {
    if (value === '' || value === null || value === undefined) return undefined;
    if (typeof value === 'boolean') return value;
    if (value === 'true' || value === '1') return true;
    if (value === 'false' || value === '0') return false;
    return value;
};

export class CreateRefereeDto {
    @IsString()
    name: string;

    @IsEmail()
    email: string;

    @IsOptional()
    @IsString()
    phone?: string;

    @IsNumber()
    @Min(0)
    @Max(100)
    commission_rate: number;

    @IsNumber()
    @Min(0)
    @Max(100)
    signup_discount: number;

    @IsOptional()
    @IsString()
    notes?: string;
}

export class UpdateRefereeDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsEmail()
    email?: string;

    @IsOptional()
    @IsString()
    phone?: string;

    @IsOptional()
    @IsNumber()
    @Min(0)
    @Max(100)
    commission_rate?: number;

    @IsOptional()
    @IsNumber()
    @Min(0)
    @Max(100)
    signup_discount?: number;

    @IsOptional()
    @IsBoolean()
    is_active?: boolean;

    @IsOptional()
    @IsString()
    notes?: string;

    @IsOptional()
    @IsString()
    @Matches(/^[A-Za-z0-9]{4,20}$/, { message: 'Referral code must be 4–20 letters or digits' })
    referral_code?: string;
}

export class RecordPaymentDto {
    /**
     * Optional. Defaults to exactly what the selected commissions are worth, which
     * is the only amount that keeps the ledger consistent. Supplying a different
     * figure requires `allow_partial`.
     */
    @IsOptional()
    @IsNumber()
    @Min(0.01)
    amount?: number;

    /** Opt in to recording a payout that deliberately does not settle the full amount owed. */
    @IsOptional()
    @IsBoolean()
    allow_partial?: boolean;

    @IsOptional()
    @IsString()
    method?: string;

    @IsOptional()
    @IsString()
    reference?: string;

    @IsOptional()
    @IsString()
    notes?: string;

    @IsOptional()
    @IsArray()
    @IsUUID(undefined, { each: true })
    commission_ids?: string[];

    /**
     * Settles the partner's own payout request. Optional because a payout an admin
     * initiates unprompted is still a payout — the request is a convenience for the
     * partner, never a precondition for paying them.
     */
    @IsOptional()
    @Transform(emptyToUndefined)
    @IsUUID()
    payout_request_id?: string;
}

/**
 * The partner's payout destination, which they own.
 *
 * Shape only here. The rules that actually matter depend on the method — a bKash
 * wallet is a Bangladeshi mobile number, a bank account is not — and a decorator
 * cannot see a sibling field, so `assertPayoutDestination` in the service enforces
 * them. A typo in a wallet number sends real money to a stranger, which is why
 * that check is not left to a `MaxLength`.
 */
export class UpdatePayoutProfileDto {
    @IsEnum(RefereePayoutMethod)
    payout_method: RefereePayoutMethod;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsString()
    @MaxLength(120)
    payout_account_name?: string;

    @IsString()
    @MaxLength(40)
    payout_account_number: string;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsString()
    @MaxLength(120)
    payout_bank_name?: string;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsString()
    @MaxLength(120)
    payout_branch?: string;
}

export class CreatePayoutRequestDto {
    /**
     * Optional — defaults to the whole balance due, which is what a partner
     * pressing "request payout" means every time but one.
     */
    @IsOptional()
    @IsNumber()
    @Min(1)
    amount?: number;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsString()
    @MaxLength(500)
    note?: string;
}

export class RejectPayoutRequestDto {
    /** Required: a decline the partner cannot act on is worse than no answer. */
    @IsString()
    @MaxLength(500)
    reason: string;
}

export class ListPayoutRequestsQueryDto {
    @IsOptional()
    @Transform(emptyToUndefined)
    @IsEnum(RefereePayoutRequestStatus)
    status?: RefereePayoutRequestStatus;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsUUID()
    referee_id?: string;
}

/**
 * Query DTO for `GET /admin/referrals/commissions`.
 *
 * `status` and `referee_id` are interpolated straight into a Prisma `where`, so
 * they are validated against the real shapes rather than accepted as bare
 * strings — an unknown status used to reach Prisma and surface as a 500 instead
 * of a 400. `status` reuses the Prisma-generated enum rather than re-declaring
 * the three values, so it cannot drift from the schema.
 */
export class ListCommissionsQueryDto {
    @IsOptional()
    @Transform(emptyToUndefined)
    @IsUUID()
    referee_id?: string;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsEnum(ReferralCommissionStatus)
    status?: ReferralCommissionStatus;

    @IsOptional()
    @Transform(toInt)
    @IsInt()
    @Min(1)
    @Max(200)
    limit?: number;

    @IsOptional()
    @Transform(toInt)
    @IsInt()
    @Min(0)
    offset?: number;
}

/**
 * Body for the public click-tracking endpoint. Both fields are attacker-controlled
 * and land in the database, so they are length-capped here as well as truncated in
 * the service — a `MaxLength` rejection is a clearer signal than a silent trim when
 * something is sending nonsense.
 */
export class TrackClickDto {
    @IsOptional()
    @IsString()
    @MaxLength(500)
    referrer?: string;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    user_agent?: string;
}

export class ListRefereesQueryDto {
    /** Archived (soft-deleted) referees are hidden unless this is set. */
    @IsOptional()
    @Transform(toBoolean)
    @IsBoolean()
    include_archived?: boolean;
}
