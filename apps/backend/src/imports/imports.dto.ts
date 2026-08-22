import {
    IsString,
    IsOptional,
    IsNumber,
    IsInt,
    IsBoolean,
    IsArray,
    IsIn,
    IsDateString,
    Min,
    Max,
    Length,
    ValidateNested,
    ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
    IMPORT_COST_TYPES,
    IMPORT_DOC_TYPES,
    LC_TYPES,
    SHIPMENT_STATUSES,
} from './imports.constants';

const ALLOCATION_BASES = ['VALUE', 'QTY', 'WEIGHT', 'CBM'];

export class ImportShipmentItemDto {
    @IsString()
    productId: string;

    @IsInt()
    @Min(1)
    quantity: number;

    /** In the shipment's currency, not BDT. */
    @IsNumber()
    @Min(0)
    unitPriceFc: number;

    /**
     * Optional overrides of the product's own figures. Supplied when this
     * shipment's goods differ from the catalogue defaults — a different pack
     * size, or an HS code the assessing officer disagreed with.
     */
    @IsOptional()
    @IsString()
    hsCode?: string;

    @IsOptional()
    @IsNumber()
    @Min(0)
    netWeightKg?: number;

    @IsOptional()
    @IsNumber()
    @Min(0)
    cbm?: number;
}

export class CreateImportShipmentDto {
    @IsString()
    storeId: string;

    @IsOptional()
    @IsString()
    supplierId?: string;

    @IsOptional()
    @IsString()
    customerPiId?: string;

    @IsString()
    @Length(3, 3)
    currency: string;

    @IsOptional()
    @IsNumber()
    @Min(0)
    fxRateAtOpen?: number;

    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => ImportShipmentItemDto)
    items: ImportShipmentItemDto[];

    // --- LC ---
    @IsOptional()
    @IsString()
    lcNumber?: string;

    @IsOptional()
    @IsIn(LC_TYPES)
    lcType?: string;

    @IsOptional()
    @IsDateString()
    lcDate?: string;

    @IsOptional()
    @IsDateString()
    lcExpiryDate?: string;

    @IsOptional()
    @IsDateString()
    latestShipmentDate?: string;

    @IsOptional()
    @IsString()
    bankName?: string;

    @IsOptional()
    @IsString()
    bankBranch?: string;

    @IsOptional()
    @IsNumber()
    @Min(0)
    @Max(100)
    marginPercent?: number;

    @IsOptional()
    @IsInt()
    @Min(0)
    tenorDays?: number;

    // --- Shipment ---
    @IsOptional()
    @IsString()
    incoterm?: string;

    @IsOptional()
    @IsString()
    blNumber?: string;

    @IsOptional()
    @IsDateString()
    blDate?: string;

    @IsOptional()
    @IsString()
    vesselName?: string;

    @IsOptional()
    @IsString()
    portOfLoading?: string;

    @IsOptional()
    @IsString()
    portOfDischarge?: string;

    @IsOptional()
    @IsDateString()
    etd?: string;

    @IsOptional()
    @IsDateString()
    eta?: string;

    // --- Customs ---
    @IsOptional()
    @IsString()
    beNumber?: string;

    @IsOptional()
    @IsDateString()
    beDate?: string;

    @IsOptional()
    @IsString()
    cfAgentName?: string;

    @IsOptional()
    @IsString()
    notes?: string;
}

/**
 * Every field optional. Items are replaced wholesale when supplied and left
 * alone when omitted, matching how the quotation editor behaves.
 */
export class UpdateImportShipmentDto extends CreateImportShipmentDto {
    @IsOptional()
    @IsString()
    declare storeId: string;

    @IsOptional()
    @IsString()
    @Length(3, 3)
    declare currency: string;

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ImportShipmentItemDto)
    declare items: ImportShipmentItemDto[];
}

export class UpdateShipmentStatusDto {
    @IsIn(SHIPMENT_STATUSES)
    status: string;
}

export class CreateImportCostDto {
    @IsIn(IMPORT_COST_TYPES)
    costType: string;

    @IsOptional()
    @IsString()
    description?: string;

    /** Charges are usually billed in BDT even on a foreign shipment. */
    @IsOptional()
    @IsString()
    @Length(3, 3)
    currency?: string;

    @IsNumber()
    amount: number;

    /** Required by the service when currency is not BDT. */
    @IsOptional()
    @IsNumber()
    @Min(0)
    fxRate?: number;

    @IsOptional()
    @IsIn(ALLOCATION_BASES)
    allocationBasis?: string;

    /**
     * Overrides the cost type's default. Set false on a duty line only with
     * good reason — see CAPITALIZED_BY_DEFAULT.
     */
    @IsOptional()
    @IsBoolean()
    isCapitalized?: boolean;

    /** Where a non-capitalised charge lands. Defaults per cost type. */
    @IsOptional()
    @IsString()
    receivableAccountId?: string;

    /** The account the money left. Omit for a charge accrued but not yet paid. */
    @IsOptional()
    @IsString()
    paidFromAccountId?: string;

    @IsOptional()
    @IsDateString()
    paidAt?: string;
}

export class UpdateImportCostDto extends CreateImportCostDto {
    @IsOptional()
    @IsIn(IMPORT_COST_TYPES)
    declare costType: string;

    @IsOptional()
    @IsNumber()
    declare amount: number;
}

export class ReceiveShipmentDto {
    /** Defaults to the store's default warehouse, as a purchase does. */
    @IsOptional()
    @IsString()
    warehouseId?: string;

    @IsOptional()
    @IsDateString()
    receivedAt?: string;

    @IsOptional()
    @IsString()
    notes?: string;
}

export class SettleShipmentDto {
    /** The rate actually paid. Compared against fx_rate_at_open. */
    @IsNumber()
    @Min(0)
    fxRateAtSettle: number;

    /** Where the settlement was paid from. */
    @IsString()
    paidFromAccountId: string;

    @IsOptional()
    @IsDateString()
    settledAt?: string;
}

export class CreateImportDocumentDto {
    @IsIn(IMPORT_DOC_TYPES)
    docType: string;

    @IsString()
    fileName: string;

    @IsString()
    storageKey: string;

    @IsOptional()
    @IsString()
    mimeType?: string;

    @IsOptional()
    @IsInt()
    @Min(0)
    fileSize?: number;
}

export class ListShipmentsQueryDto {
    @IsOptional()
    @IsIn(SHIPMENT_STATUSES)
    status?: string;

    @IsOptional()
    @IsString()
    supplierId?: string;

    /** Open = anything not RECEIVED, CLOSED or CANCELLED. */
    @IsOptional()
    @IsString()
    openOnly?: string;
}
