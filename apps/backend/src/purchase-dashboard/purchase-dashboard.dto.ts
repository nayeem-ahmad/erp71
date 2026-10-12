import { IsDateString, IsOptional } from 'class-validator';
import { IsStoreIdOrAll } from '../common/store-id-or-all.validator';

/** Date-only (`YYYY-MM-DD`) window, read as whole local days by the service. */
export class PurchaseDashboardQueryDto {
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
