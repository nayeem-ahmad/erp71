import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

/** See the note on the same helper in `create-store.dto.ts`. */
const trim = ({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value;

export class UpdateStoreDto {
    @Transform(trim)
    @IsString({ message: 'Store name is required.' })
    @MinLength(1, { message: 'Store name is required.' })
    @MaxLength(100)
    name: string;
}
