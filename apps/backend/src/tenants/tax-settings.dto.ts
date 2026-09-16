import { IsBoolean, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Settings › Tax. The first three fields are the workspace's tax identity; the
 * rest are what an NBR Mushak 6.x document carries in its issuer block, which
 * nothing else in the system knows.
 */
export class UpdateTaxSettingsDto {
    /** Percentage, e.g. 15 for the standard rate. Null clears it. */
    @IsOptional()
    @IsNumber()
    @Min(0)
    @Max(100)
    default_vat_rate?: number | null;

    /** বিআইএন — the 13-digit business identification number. */
    @IsOptional()
    @IsString()
    @MaxLength(32)
    vat_registration_no?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(32)
    business_tin?: string | null;

    /**
     * Whether this workspace issues Mushak documents. Off means the sales
     * module prints a plain invoice, which is what a business without a BIN
     * must hand its customers.
     */
    @IsOptional()
    @IsBoolean()
    mushak_enabled?: boolean;

    /** চালানপত্র ইস্যুর ঠিকানা — the registered premises. */
    @IsOptional()
    @IsString()
    @MaxLength(500)
    mushak_issue_address?: string | null;

    /** প্রতিষ্ঠানের দায়িত্বপ্রাপ্ত ব্যক্তি — who signs for the business. */
    @IsOptional()
    @IsString()
    @MaxLength(200)
    mushak_officer_name?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    mushak_officer_designation?: string | null;

    /** অর্থনৈতিক কার্যক্রম, as it appears on the registration certificate. */
    @IsOptional()
    @IsString()
    @MaxLength(200)
    mushak_economic_activity?: string | null;
}
