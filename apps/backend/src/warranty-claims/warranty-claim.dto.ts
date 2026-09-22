import { IsString, IsOptional, IsUUID, MaxLength } from 'class-validator';

export class CreateWarrantyClaimDto {
    @IsUUID()
    storeId: string;

    @IsString()
    @MaxLength(120)
    serialNumber: string;

    @IsString()
    @MaxLength(255)
    reason: string;

    @IsOptional()
    @IsString()
    @MaxLength(2000)
    description?: string;
}

export class UpdateWarrantyClaimStatusDto {
    /** Checked against VALID_STATUSES in the service, which owns the transitions. */
    @IsString()
    status: string;

    @IsOptional()
    @IsString()
    @MaxLength(2000)
    resolutionNotes?: string;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    replacementSerialNumber?: string;
}
