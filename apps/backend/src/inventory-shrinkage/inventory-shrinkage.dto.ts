import { Transform, Type } from 'class-transformer';
import {
    ArrayMinSize,
    IsArray,
    IsIn,
    IsInt,
    IsNotEmpty,
    IsOptional,
    IsString,
    IsUUID,
    Min,
    ValidateNested,
} from 'class-validator';

/**
 * Which way the count was wrong.
 *
 * LOSS is shrinkage proper — the shelf is short, and the entry takes the
 * difference out. FOUND is the mirror — the shelf is over, and the entry puts
 * the difference in. One document type, one screen, one sign.
 */
export const SHRINKAGE_DIRECTIONS = ['LOSS', 'FOUND'] as const;
export type ShrinkageDirection = (typeof SHRINKAGE_DIRECTIONS)[number];

/** Collapses a whitespace-only note to '' so @IsNotEmpty actually rejects it. */
const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateInventoryShrinkageItemDto {
    @IsUUID()
    productId: string;

    @IsInt()
    @Min(1)
    quantity: number;

    @IsOptional()
    @IsString()
    note?: string;
}

export class CreateInventoryShrinkageDto {
    /**
     * Omitted means LOSS. Every caller that predates found-stock entry sends no
     * direction and must keep writing write-offs.
     */
    @IsOptional()
    @IsIn(SHRINKAGE_DIRECTIONS, { message: 'Direction must be LOSS or FOUND.' })
    direction?: ShrinkageDirection;

    @IsUUID()
    warehouseId: string;

    @IsUUID(undefined, { message: 'A reason is required.' })
    reasonId: string;

    /**
     * Required, and not merely present: an adjustment is the one document in
     * inventory with no counterparty — no supplier, no customer, no second
     * warehouse — so the note is the whole of its evidence. An entry saying
     * only "Damage, 12 units" is unauditable a month later; "Damage" plus
     * "crushed by forklift, bay 3, photos with Rahim" is not.
     *
     * Trimmed first so a space bar does not satisfy it.
     */
    @IsString({ message: 'A note is required.' })
    @Transform(trimmed)
    @IsNotEmpty({ message: 'A note is required.' })
    notes: string;

    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => CreateInventoryShrinkageItemDto)
    items: CreateInventoryShrinkageItemDto[];
}
