import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PASSWORD_MAX_MIN_LENGTH, PASSWORD_MIN_LENGTH_FLOOR } from '@erp71/shared-types';

/**
 * Every field is optional so the settings form can PATCH one switch without
 * restating the rest; omitted fields keep whatever the workspace has.
 *
 * `min_length` is bounded here rather than clamped, so an admin who types 4
 * learns the floor exists instead of silently getting 8 back. The service still
 * normalizes on the way through — the bounds belong on both sides of a value a
 * password check depends on.
 */
export class UpdatePasswordPolicyDto {
    @IsOptional()
    @IsInt({ message: 'Minimum length must be a whole number.' })
    @Min(PASSWORD_MIN_LENGTH_FLOOR, {
        message: `Minimum length cannot be below ${PASSWORD_MIN_LENGTH_FLOOR} characters.`,
    })
    @Max(PASSWORD_MAX_MIN_LENGTH, {
        message: `Minimum length cannot be above ${PASSWORD_MAX_MIN_LENGTH} characters.`,
    })
    min_length?: number;

    @IsOptional()
    @IsBoolean()
    require_uppercase?: boolean;

    @IsOptional()
    @IsBoolean()
    require_lowercase?: boolean;

    @IsOptional()
    @IsBoolean()
    require_number?: boolean;

    @IsOptional()
    @IsBoolean()
    require_symbol?: boolean;

    @IsOptional()
    @IsBoolean()
    block_common?: boolean;
}
