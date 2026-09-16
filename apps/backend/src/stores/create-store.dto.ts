import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Surrounding whitespace is never part of a name, and stripping it here is what
 * makes `@MinLength(1)` mean "has a name" rather than "sent some characters" —
 * a branch called "   " is as nameless as one called "".
 */
const trim = ({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value;

export class CreateStoreDto {
    @Transform(trim)
    @IsString({ message: 'Store name is required.' })
    @MinLength(1, { message: 'Store name is required.' })
    @MaxLength(100)
    name: string;

    @IsOptional()
    @Transform(trim)
    @IsString()
    @MaxLength(255)
    address?: string;
}
