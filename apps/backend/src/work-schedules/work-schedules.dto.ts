import {
    IsArray, IsBoolean, IsDateString, IsInt, IsOptional, IsString, IsUUID, Max, Min, ValidateNested,
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
