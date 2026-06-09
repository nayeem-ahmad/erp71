import { IsString, IsDateString, IsOptional, IsEnum, IsNumber, IsPositive, IsUUID, Min } from 'class-validator';
import { Type } from 'class-transformer';

export enum AttendanceStatusDto {
    PRESENT = 'PRESENT',
    ABSENT = 'ABSENT',
    HALF_DAY = 'HALF_DAY',
    HOLIDAY = 'HOLIDAY',
}

export enum LeaveRequestStatusDto {
    PENDING = 'PENDING',
    APPROVED = 'APPROVED',
    REJECTED = 'REJECTED',
    CANCELLED = 'CANCELLED',
}

export class UpsertAttendanceDto {
    @IsUUID()
    employee_id: string;

    @IsDateString()
    date: string; // YYYY-MM-DD

    @IsEnum(AttendanceStatusDto)
    status: AttendanceStatusDto;

    @IsOptional()
    @IsDateString()
    clock_in?: string;

    @IsOptional()
    @IsDateString()
    clock_out?: string;

    @IsOptional()
    @IsString()
    notes?: string;
}

export class CreateLeaveTypeDto {
    @IsString()
    name: string;

    @IsNumber()
    @Min(0)
    @Type(() => Number)
    days_per_year: number;
}

export class UpdateLeaveTypeDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsNumber()
    @Min(0)
    @Type(() => Number)
    days_per_year?: number;
}

export class SetLeaveBalanceDto {
    @IsUUID()
    employee_id: string;

    @IsUUID()
    leave_type_id: string;

    @IsNumber()
    @Type(() => Number)
    year: number;

    @IsNumber()
    @Min(0)
    @Type(() => Number)
    total_days: number;
}

export class CreateLeaveRequestDto {
    @IsUUID()
    employee_id: string;

    @IsUUID()
    leave_type_id: string;

    @IsDateString()
    start_date: string;

    @IsDateString()
    end_date: string;

    @IsNumber()
    @IsPositive()
    @Type(() => Number)
    days: number;

    @IsOptional()
    @IsString()
    reason?: string;
}

export class ReviewLeaveRequestDto {
    @IsEnum(LeaveRequestStatusDto)
    status: LeaveRequestStatusDto;

    @IsOptional()
    @IsString()
    approver_note?: string;
}
