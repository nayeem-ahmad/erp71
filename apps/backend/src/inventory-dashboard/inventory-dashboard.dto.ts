import { IsDateString, IsOptional } from 'class-validator';

/**
 * Window for the inventory dashboard. Both bounds are date-only (`YYYY-MM-DD`)
 * in the server's timezone; the service widens `to` to the end of that day so a
 * single-day window is not empty.
 */
export class InventoryDashboardQueryDto {
    @IsOptional()
    @IsDateString()
    from?: string;

    @IsOptional()
    @IsDateString()
    to?: string;
}
