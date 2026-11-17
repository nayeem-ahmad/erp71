import { IsDateString, IsOptional } from 'class-validator';
import { IsStoreIdOrAll } from '../common/store-id-or-all.validator';

/** The period the scorecard covers; it compares against the same number of days just before. */
export class PlatformKpiQueryDto {
    @IsOptional()
    @IsDateString()
    from?: string;

    @IsOptional()
    @IsDateString()
    to?: string;
}

export class TenantKpiQueryDto extends PlatformKpiQueryDto {
    /** A branch id, or `all` for the whole business. See `BranchScopeService`. */
    @IsOptional()
    @IsStoreIdOrAll()
    storeId?: string;
}
