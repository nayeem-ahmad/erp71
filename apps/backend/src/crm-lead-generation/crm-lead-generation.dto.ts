import { Transform, Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayNotEmpty,
    IsArray,
    IsBoolean,
    IsInt,
    IsOptional,
    IsString,
    Max,
    MaxLength,
    Min,
    ValidateNested,
} from 'class-validator';

const emptyToUndefined = ({ value }: { value: unknown }) =>
    value === '' || value === null ? undefined : value;

export class SearchLeadGenerationDto {
    @IsOptional()
    @Transform(emptyToUndefined)
    @IsString()
    @MaxLength(200)
    niche?: string;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsString()
    @MaxLength(120)
    location?: string;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsString()
    @MaxLength(80)
    companySize?: string;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsString()
    @MaxLength(200)
    keywords?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(15)
    limit?: number;
}

export class ImportLeadGenerationCandidateDto {
    @IsString()
    @MaxLength(200)
    company_name: string;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    website_url?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    linkedin_url?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    email?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    location?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(1000)
    description?: string | null;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    fit_score?: number;

    @IsOptional()
    @IsString()
    @MaxLength(1000)
    fit_reason?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    source_url?: string | null;

    @IsOptional()
    @IsBoolean()
    unverified?: boolean;

    @IsOptional()
    @IsString()
    existing_lead_id?: string | null;
}

export class ImportLeadGenerationDto {
    @IsArray()
    @ArrayNotEmpty()
    @ArrayMaxSize(15)
    @ValidateNested({ each: true })
    @Type(() => ImportLeadGenerationCandidateDto)
    candidates: ImportLeadGenerationCandidateDto[];
}
