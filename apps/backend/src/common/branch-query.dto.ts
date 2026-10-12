import { IsOptional } from 'class-validator';
import { IsStoreIdOrAll } from './store-id-or-all.validator';

/**
 * The query of a branch-aware read that takes nothing but the branch filter.
 * Declared because the global ValidationPipe runs with `forbidNonWhitelisted`:
 * an undeclared `storeId` would be a 400, not an ignored extra.
 */
export class BranchQueryDto {
    /** A branch id or `all`; resolved against the caller's access by the controller. */
    @IsOptional()
    @IsStoreIdOrAll()
    storeId?: string;
}
