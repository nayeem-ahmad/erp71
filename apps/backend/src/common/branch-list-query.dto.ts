import { IsOptional, IsString } from 'class-validator';
import { PaginationDto } from './pagination.dto';
import { IsStoreIdOrAll } from './store-id-or-all.validator';

/**
 * The query of a branch-aware transaction list: paging, the created-date
 * window and the branch filter.
 *
 * Declared as one class because these routes bind `@Query()` to a DTO, and the
 * global ValidationPipe runs with `forbidNonWhitelisted`: a key the DTO does
 * not declare — `storeId`, or the `createdFrom` / `createdTo` the lists already
 * read — is a 400 for the whole request, not an ignored extra.
 */
export class BranchListQueryDto extends PaginationDto {
    /** A branch id or `all`; resolved against the caller's access by the controller. */
    @IsOptional()
    @IsStoreIdOrAll()
    storeId?: string;

    @IsOptional()
    @IsString()
    createdFrom?: string;

    @IsOptional()
    @IsString()
    createdTo?: string;
}

/** A branch-aware list that also takes a sort column and direction. */
export class SortableBranchListQueryDto extends BranchListQueryDto {
    @IsOptional()
    @IsString()
    sortBy?: string;

    @IsOptional()
    @IsString()
    sortDir?: string;
}
