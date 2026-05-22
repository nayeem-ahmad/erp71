import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class LookupSerialDto {
    @IsString()
    @IsNotEmpty()
    serialNumber: string;
}

export class CreateWarrantyClaimDto {
    @IsString()
    @IsNotEmpty()
    serialId: string;

    @IsString()
    @IsNotEmpty()
    customerName: string;

    @IsString()
    @IsOptional()
    customerPhone?: string;

    @IsString()
    @IsNotEmpty()
    issueDescription: string;
}

export class UpdateClaimStatusDto {
    @IsString()
    @IsNotEmpty()
    status: string;

    @IsString()
    @IsOptional()
    resolutionNotes?: string;
}
