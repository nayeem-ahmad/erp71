import { Transform, Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';

export class WarehouseTransferItemDto {
    @IsUUID()
    productId: string;

    @IsInt()
    @Min(1)
    quantity: number;

    @IsOptional()
    @IsString()
    note?: string;
}

export class CreateWarehouseTransferDto {
    @IsUUID()
    sourceWarehouseId: string;

    @IsUUID()
    destinationWarehouseId: string;

    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => WarehouseTransferItemDto)
    items: WarehouseTransferItemDto[];

    @IsOptional()
    @IsString()
    notes?: string;

    @IsOptional()
    @IsString()
    status?: 'DRAFT' | 'SENT';
}

export class ReceiveWarehouseTransferItemDto {
    @IsUUID()
    productId: string;

    @IsInt()
    @Min(1)
    quantityReceived: number;

    @IsOptional()
    @IsString()
    note?: string;
}

export class ReceiveWarehouseTransferDto {
    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => ReceiveWarehouseTransferItemDto)
    items: ReceiveWarehouseTransferItemDto[];
}

export class RejectWarehouseTransferDto {
    /**
     * Why the transfer was turned down. Optional so an approver is never blocked
     * from refusing one, but the UI asks for it: the requester is the person who
     * has to act on a rejection, and a bare status tells them nothing.
     */
    @IsOptional()
    @IsString()
    @MaxLength(500)
    reason?: string;
}

export class ListWarehouseTransfersQueryDto {
    @IsOptional()
    @IsString()
    status?: string;

    @IsOptional()
    @IsUUID()
    sourceWarehouseId?: string;

    @IsOptional()
    @IsUUID()
    destinationWarehouseId?: string;

    @IsOptional()
    @IsUUID()
    productId?: string;

    /**
     * Narrow to transfers that cross branches, or to those that stay inside one.
     * A query string carries no booleans, so `'true'`/`'false'` are mapped here
     * and anything else is left undefined — an unparseable value must widen the
     * list back to everything, never silently mean `false`.
     */
    @IsOptional()
    @Transform(({ value }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : undefined))
    @IsBoolean()
    isCrossBranch?: boolean;

    @IsOptional()
    @IsString()
    from?: string;

    @IsOptional()
    @IsString()
    to?: string;
}