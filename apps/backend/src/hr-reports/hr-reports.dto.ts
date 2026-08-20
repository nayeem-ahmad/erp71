import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * The dimension an HR report collapses to.
 *
 * Shared by the attendance and payroll-cost reports rather than one enum each:
 * both roll up the same population — employees, their department, their
 * designation, the month — and two enums drifting apart is how "by department"
 * ends up meaning two different things on two screens.
 */
export enum HrReportGroupByDto {
    EMPLOYEE = 'employee',
    DEPARTMENT = 'department',
    DESIGNATION = 'designation',
    MONTH = 'month',
}

/**
 * An inclusive month range.
 *
 * Months rather than dates because everything these reports read is stored per
 * month — `AttendanceMonthSnapshot` and `PayrollRun` both key on (year, month),
 * so a date range would have to be rounded to months anyway, and rounding it
 * in the UI is a lie the user cannot see.
 */
export class HrReportMonthRangeDto {
    @IsInt() @Min(2000) @Max(2200) @Type(() => Number)
    fromYear!: number;

    @IsInt() @Min(1) @Max(12) @Type(() => Number)
    fromMonth!: number;

    @IsInt() @Min(2000) @Max(2200) @Type(() => Number)
    toYear!: number;

    @IsInt() @Min(1) @Max(12) @Type(() => Number)
    toMonth!: number;

    @IsOptional() @IsEnum(HrReportGroupByDto)
    groupBy?: HrReportGroupByDto;

    @IsOptional() @IsUUID()
    departmentId?: string;

    @IsOptional() @IsUUID()
    employeeId?: string;
}

/**
 * Leave balances are held per calendar year (`LeaveBalance.year`), so this one
 * takes a year rather than a range — asking for "July to September balances"
 * would have no meaning against the stored shape.
 */
export class LeaveBalanceReportDto {
    @IsInt() @Min(2000) @Max(2200) @Type(() => Number)
    year!: number;

    @IsOptional() @IsUUID()
    departmentId?: string;

    @IsOptional() @IsUUID()
    leaveTypeId?: string;

    @IsOptional() @IsUUID()
    employeeId?: string;
}
