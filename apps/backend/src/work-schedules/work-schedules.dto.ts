import {
    ArrayMaxSize, ArrayNotEmpty, IsArray, IsBoolean, IsDateString, IsInt, IsNotEmpty, IsOptional,
    IsString, IsUUID, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ScheduleDayDto {
    /** 0 = Sunday … 6 = Saturday, matching `Date#getDay()`. */
    @IsInt()
    @Min(0)
    @Max(6)
    @Type(() => Number)
    weekday: number;

    @IsBoolean()
    is_working: boolean;

    /** Minutes from local midnight. 540 = 09:00. */
    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(1440)
    @Type(() => Number)
    start_minute?: number | null;

    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(1440)
    @Type(() => Number)
    end_minute?: number | null;

    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(600)
    @Type(() => Number)
    break_minutes?: number;
}

export class CreateWorkScheduleDto {
    @IsString()
    name: string;

    @IsOptional()
    @IsBoolean()
    is_default?: boolean;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ScheduleDayDto)
    days: ScheduleDayDto[];
}

export class UpdateWorkScheduleDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsBoolean()
    is_default?: boolean;

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ScheduleDayDto)
    days?: ScheduleDayDto[];
}

export class CreateHolidayDto {
    @IsDateString()
    date: string;

    @IsString()
    name: string;
}

export class UpdateHolidayDto {
    @IsOptional()
    @IsDateString()
    date?: string;

    @IsOptional()
    @IsString()
    name?: string;
}

export class HolidayItemDto {
    @IsDateString()
    date: string;

    @IsString()
    @IsNotEmpty()
    @MaxLength(120)
    name: string;
}

/**
 * A year's worth of holidays in one request.
 *
 * Capped at 366 because that is the most dates a year can hold — a larger
 * payload is a bug or an attack, not a calendar.
 */
export class BulkHolidayDto {
    @IsArray()
    @ArrayNotEmpty()
    @ArrayMaxSize(366)
    @ValidateNested({ each: true })
    @Type(() => HolidayItemDto)
    items: HolidayItemDto[];

    /** Rename a date that already has a holiday, instead of leaving it alone. */
    @IsOptional()
    @IsBoolean()
    overwrite?: boolean;
}

export class CopyHolidayYearDto {
    @IsInt()
    @Min(2000)
    @Max(2200)
    @Type(() => Number)
    from_year: number;

    @IsInt()
    @Min(2000)
    @Max(2200)
    @Type(() => Number)
    to_year: number;

    @IsOptional()
    @IsBoolean()
    overwrite?: boolean;
}

export class AssignScheduleDto {
    @IsUUID()
    employee_id: string;

    @IsUUID()
    schedule_id: string;

    @IsDateString()
    effective_from: string;
}

export class HolidayQueryDto {
    @IsOptional()
    @IsInt()
    @Min(2000)
    @Max(2200)
    @Type(() => Number)
    year?: number;
}

/** `year` as a required query parameter, for the suggestion list. */
export class HolidayYearQueryDto {
    @IsInt()
    @Min(2000)
    @Max(2200)
    @Type(() => Number)
    year: number;
}
