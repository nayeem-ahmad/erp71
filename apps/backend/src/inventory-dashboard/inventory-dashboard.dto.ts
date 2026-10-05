import { IsDateString, IsOptional } from 'class-validator';
import { IsStoreIdOrAll } from '../common/store-id-or-all.validator';

/**
 * Window for the inventory dashboard. Both bounds are date-only (`YYYY-MM-DD`)
 * in the server's timezone; the service widens `to` to the end of that day so a
 * single-day window is not empty.
 */
export class InventoryDashboardQueryDto {
    /** One branch, or `all`. Resolved against the caller's branch access before use. */
    @IsOptional()
    @IsStoreIdOrAll()
    storeId?: string;

    @IsOptional()
    @IsDateString()
    from?: string;

    @IsOptional()
    @IsDateString()
    to?: string;
}
