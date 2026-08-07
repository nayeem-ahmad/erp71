import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateChecklistTemplateDto {
    @IsEnum(['ONBOARDING', 'OFFBOARDING'] as any)
    kind: string;

    @IsString() title: string;
    @IsOptional() @IsString() description?: string;
    @IsOptional() @IsInt() @Type(() => Number) sort_order?: number;
}

export class StartChecklistDto {
    @IsEnum(['ONBOARDING', 'OFFBOARDING'] as any)
    kind: 'ONBOARDING' | 'OFFBOARDING';
}

export class CompleteChecklistItemDto {
    @IsOptional() @IsString() notes?: string;
}

export class RecordExitDto {
    @IsEnum(['RESIGNED', 'TERMINATED', 'CONTRACT_ENDED'] as any)
    status: 'RESIGNED' | 'TERMINATED' | 'CONTRACT_ENDED';

    @IsDateString() last_working_day: string;

    @IsOptional() @IsString() exit_reason?: string;
    @IsOptional() @IsString() exit_notes?: string;
}

export class PrepareSettlementDto {
    @IsInt() @Min(2000) @Max(2200) @Type(() => Number) year: number;
    @IsInt() @Min(1) @Max(12) @Type(() => Number) month: number;
}
