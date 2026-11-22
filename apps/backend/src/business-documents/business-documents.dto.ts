import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { PartialType } from '@nestjs/swagger';
import { BUSINESS_DOCUMENT_TYPES, type BusinessDocumentType } from '@erp71/shared-types';

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** A cleared field arrives as '' or null; both mean "no value", which is kept as null. */
const blankToNull = ({ value }: { value: unknown }) =>
    value === '' || value === null ? null : typeof value === 'string' ? value.trim() : value;
const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

export class CreateBusinessDocumentDto {
    @IsIn(BUSINESS_DOCUMENT_TYPES)
    docType!: BusinessDocumentType;

    @Transform(trimmed)
    @IsString()
    @IsNotEmpty()
    @MaxLength(200)
    title!: string;

    @IsOptional()
    @Transform(blankToNull)
    @IsString()
    @MaxLength(100)
    number?: string | null;

    @IsOptional()
    @Transform(blankToNull)
    @IsString()
    @MaxLength(200)
    issuingAuthority?: string | null;

    @IsOptional()
    @Transform(blankToNull)
    @Matches(CALENDAR_DAY, { message: 'issueDate must be a date (YYYY-MM-DD)' })
    issueDate?: string | null;

    @IsOptional()
    @Transform(blankToNull)
    @Matches(CALENDAR_DAY, { message: 'expiryDate must be a date (YYYY-MM-DD)' })
    expiryDate?: string | null;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    @Max(365)
    remindDaysBefore?: number;

    @IsOptional()
    @Transform(blankToNull)
    @IsString()
    @MaxLength(2000)
    notes?: string | null;
}

export class UpdateBusinessDocumentDto extends PartialType(CreateBusinessDocumentDto) {}

/** The scanned copy, sent as base64 — a PDF or a photo of the certificate. */
export class UploadBusinessDocumentFileDto {
    /** A `data:` URL or bare base64. */
    @IsString()
    @IsNotEmpty()
    fileBase64!: string;

    @IsOptional()
    @IsString()
    @MaxLength(100)
    mimeType?: string;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    fileName?: string;
}
