import { IsDateString, IsInt, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Note what is *absent* from every DTO here: an `employee_id`. The portal
 * resolves the employee from the token in `EmployeeGuard`, so accepting one
 * would be the whole vulnerability — a field a client could set to somebody
 * else's id.
 */

export class PortalPeriodQueryDto {
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
}

/**
 * A check-in or check-out. Location is optional in the DTO and required by the
 * *service* when the tenant has geofencing on — the requirement is a tenant
 * policy, not a wire-format one, so it does not belong here.
 */
export class ClockDto {
    @IsOptional()
    @IsNumber()
    @Type(() => Number)
    latitude?: number;

    @IsOptional()
    @IsNumber()
    @Type(() => Number)
    longitude?: number;
}

export class ApplyForLeaveDto {
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
