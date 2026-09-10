import { IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * The body every entry-cancellation endpoint takes.
 *
 * The note is the point of the feature, so it is required at the boundary
 * rather than checked in each service: cancelling a posted entry reverses stock,
 * party balances and the ledger all at once, and six months later the only
 * record of *why* is this sentence. `@IsString()` alone would accept `"   "`,
 * so the value is trimmed before validation and floored at
 * `CANCELLATION_NOTE_MIN_LENGTH` — long enough to rule out "x" and "ok", short
 * enough not to argue with someone typing "duplicate".
 */
export const CANCELLATION_NOTE_MIN_LENGTH = 5;
export const CANCELLATION_NOTE_MAX_LENGTH = 500;

export class CancelEntryDto {
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    @IsString()
    @MinLength(CANCELLATION_NOTE_MIN_LENGTH, {
        message: 'A cancellation note is required and must say why the entry is being cancelled.',
    })
    @MaxLength(CANCELLATION_NOTE_MAX_LENGTH)
    note: string;
}
