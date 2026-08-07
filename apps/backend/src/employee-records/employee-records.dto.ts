import {
    IsBoolean, IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUUID, Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AssignAssetDto {
    @IsUUID() employee_id: string;

    @IsOptional() @IsString() item_name?: string;
    @IsOptional() @IsUUID() fixed_asset_id?: string;
    @IsOptional() @IsString() serial_number?: string;
    @IsOptional() @IsInt() @Min(1) @Type(() => Number) quantity?: number;

    @IsDateString() assigned_on: string;

    @IsOptional() @IsString() condition_out?: string;
    @IsOptional() @IsString() notes?: string;
}

export class ReturnAssetDto {
    @IsDateString() returned_on: string;
    @IsOptional() @IsString() condition_in?: string;
}

export class AssignmentQueryDto {
    @IsOptional() @IsUUID() employeeId?: string;
    @IsOptional() @IsBoolean() @Type(() => Boolean) outstandingOnly?: boolean;
}

export class CreatePolicyDto {
    @IsString() title: string;
    @IsString() body: string;

    @IsOptional() @IsEnum(['POLICY', 'NOTICE'] as any) kind?: string;
    @IsOptional() @IsBoolean() requires_acknowledgement?: boolean;
    @IsOptional() @IsDateString() effective_from?: string;
    @IsOptional() @IsBoolean() publish?: boolean;
}

export class UpdatePolicyDto {
    @IsOptional() @IsString() title?: string;
    @IsOptional() @IsString() body?: string;
    @IsOptional() @IsEnum(['POLICY', 'NOTICE'] as any) kind?: string;
    @IsOptional() @IsBoolean() requires_acknowledgement?: boolean;
    @IsOptional() @IsDateString() effective_from?: string;
    @IsOptional() @IsBoolean() publish?: boolean;
}

export class AddDocumentDto {
    @IsString() title: string;

    @IsOptional()
    @IsEnum(['CONTRACT', 'OFFER_LETTER', 'NID', 'PASSPORT', 'CERTIFICATE', 'OTHER'] as any)
    kind?: string;

    @IsOptional() @IsDateString() expires_on?: string;
}
