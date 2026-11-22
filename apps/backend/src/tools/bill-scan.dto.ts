import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { BILL_SCAN_TARGETS, type BillScanTarget } from '@erp71/shared-types';

export class ScanBillDto {
    @IsIn(BILL_SCAN_TARGETS)
    target!: BillScanTarget;

    /** A `data:` URL or bare base64 of the photo, already shrunk by the browser. */
    @IsString()
    @IsNotEmpty()
    imageBase64!: string;

    @IsOptional()
    @IsString()
    @MaxLength(50)
    mimeType?: string;

    /** The photo's size after shrinking, so the reply can carry the estimate the screen showed. */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(10_000)
    width?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(10_000)
    height?: number;
}
