import { IsString, IsDateString, IsOptional, IsEnum, IsNumber, IsPositive, IsUUID, IsBoolean, IsInt, Min, Max } from 'class-validator';
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

export enum PunchDirectionDto {
    IN = 'IN',
    OUT = 'OUT',
}

export class CreatePunchDto {
    @IsUUID()
    employee_id: string;

    /**
     * Local wall-clock moment of the punch, e.g. `2026-08-11T09:04:00`. Sent
     * without a zone on purpose: attendance is judged against a schedule kept
     * in minutes from local midnight, so the server's local reading is the one
     * that must match what the employee experienced.
     */
    @IsDateString()
    punched_at: string;

    @IsEnum(PunchDirectionDto)
    direction: PunchDirectionDto;

    @IsOptional()
    @IsString()
    notes?: string;

    /** ADMIN unless an importer says otherwise. `SELF` is written server-side. */
    @IsOptional()
    @IsEnum(['ADMIN', 'IMPORT'] as any)
    source?: 'ADMIN' | 'IMPORT';
}

export class UpdatePunchDto {
    @IsOptional()
    @IsDateString()
    punched_at?: string;

    @IsOptional()
    @IsEnum(PunchDirectionDto)
    direction?: PunchDirectionDto;

    @IsOptional()
    @IsString()
    notes?: string;
}

export class PunchQueryDto {
    @IsOptional()
    @IsUUID()
    employeeId?: string;

    @IsOptional()
    @IsDateString()
    startDate?: string;

    @IsOptional()
    @IsDateString()
    endDate?: string;

    @IsOptional()
    @IsEnum(PunchDirectionDto)
    direction?: PunchDirectionDto;

    @IsOptional()
    @IsInt()
    @Min(1)
    @Type(() => Number)
    page?: number;

    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(200)
    @Type(() => Number)
    limit?: number;
}

export class MonthQueryDto {
    @IsInt()
    @Min(2000)
    @Max(2200)
    @Type(() => Number)
    year: number;

    @IsInt()
    @Min(1)
    @Max(12)
    @Type(() => Number)
    month: number;
}

export class OvertimeQueryDto {
    @IsOptional()
    @IsInt()
    @Min(2000)
    @Max(2200)
    @Type(() => Number)
    year?: number;

    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(12)
    @Type(() => Number)
    month?: number;

    @IsOptional()
    @IsString()
    status?: string;

    @IsOptional()
    @IsUUID()
    employeeId?: string;
}

export class ReviewOvertimeDto {
    @IsEnum(['APPROVED', 'REJECTED'] as any)
    status: 'APPROVED' | 'REJECTED';

    /** Approve fewer minutes than observed. More is refused by the service. */
    @IsOptional()
    @IsInt()
    @Min(0)
    @Type(() => Number)
    minutes?: number;

    @IsOptional()
    @IsString()
    note?: string;
}

export class UpdateAttendanceSettingsDto {
    @IsOptional()
    @IsBoolean()
    self_service_enabled?: boolean;

    @IsOptional()
    @IsBoolean()
    geofence_enabled?: boolean;

    /** Metres. Below 20 is inside phone GPS error; above 5km is not a fence. */
    @IsOptional()
    @IsInt()
    @Min(20)
    @Max(5000)
    @Type(() => Number)
    geofence_radius_m?: number;

    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(240)
    @Type(() => Number)
    grace_minutes?: number;
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
