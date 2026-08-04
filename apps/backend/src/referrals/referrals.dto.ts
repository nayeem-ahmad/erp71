import { IsArray, IsBoolean, IsEmail, IsEnum, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { ReferralCommissionStatus } from '@prisma/client';

const emptyToUndefined = ({ value }: { value: unknown }) =>
    value === '' || value === null ? undefined : value;

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
    @IsNumber()
    @Min(0.01)
    amount: number;

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
}
