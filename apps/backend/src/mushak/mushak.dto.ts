import { IsBooleanString, IsOptional, IsString, IsUUID } from 'class-validator';

/**
 * A tax period. NBR's is the calendar month, but a book is just as often
 * pulled for a quarter or a year-to-date check, so the range is free-form and
 * the response echoes back what it covered.
 */
export class GetMushakPeriodDto {
    /** Inclusive first day, `YYYY-MM-DD` in the workspace's own timezone. */
    @IsOptional()
    @IsString()
    from?: string;

    /** Inclusive last day. */
    @IsOptional()
    @IsString()
    to?: string;

    /** Limit the book to one branch. Omit for the whole registration. */
    @IsOptional()
    @IsUUID()
    storeId?: string;
}

export class GetSalesBookDto extends GetMushakPeriodDto {
    /**
     * Drop lines that carry no VAT and no supplementary duty. Off by default:
     * rule 40 wants every supply in the book, taxable or not, and a book that
     * silently hides the zero-rated ones will not reconcile to the 9.1 return.
     */
    @IsOptional()
    @IsBooleanString()
    taxableOnly?: string;
}
