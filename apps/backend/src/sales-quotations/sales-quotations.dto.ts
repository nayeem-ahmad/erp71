import {
    IsString,
    IsArray,
    IsNumber,
    IsOptional,
    IsDateString,
    IsIn,
    IsInt,
    Min,
    Max,
    Length,
    ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * A quotation and a proforma invoice are the same record with a different name
 * on the paper. `QUOTE` is the default so every pre-existing row and every
 * caller that does not know about proformas keeps its current behaviour.
 */
export const QUOTATION_DOC_KINDS = ['QUOTE', 'PROFORMA'] as const;
export type QuotationDocKind = (typeof QUOTATION_DOC_KINDS)[number];

/**
 * Incoterms 2020, restricted to the seven a Bangladeshi exporter or importer
 * actually writes on a PI. Free text would defeat the point: the whole value of
 * the field is that a buyer's bank recognises the three letters.
 */
export const INCOTERMS = ['EXW', 'FCA', 'FOB', 'CFR', 'CIF', 'DAP', 'DDP'] as const;

export class CreateQuotationItemDto {
    @IsString()
    productId: string;

    @IsNumber()
    quantity: number;

    @IsNumber()
    unitPrice: number;
}

/**
 * The commercial terms that turn a quotation into a proforma invoice. Shared by
 * create and update so the two cannot drift — a field validated on the way in
 * but not on the way back out is the usual way an enum-ish column acquires junk.
 */
export class ProformaTermsDto {
    @IsOptional()
    @IsIn(QUOTATION_DOC_KINDS)
    docKind?: QuotationDocKind;

    /**
     * ISO 4217. Length-checked rather than enum-checked: the list of currencies
     * a tenant might quote in is open, but a three-letter code is not.
     */
    @IsOptional()
    @IsString()
    @Length(3, 3)
    currency?: string;

    /**
     * BDT per one unit of `currency`. Required by the service when currency is
     * not BDT; optional here so the DTO stays usable for a BDT-only caller.
     */
    @IsOptional()
    @IsNumber()
    @Min(0)
    exchangeRate?: number;

    @IsOptional()
    @IsIn(INCOTERMS)
    incoterm?: string;

    @IsOptional()
    @IsString()
    portOfLoading?: string;

    @IsOptional()
    @IsString()
    portOfDischarge?: string;

    @IsOptional()
    @IsString()
    paymentTerms?: string;

    @IsOptional()
    @IsNumber()
    @Min(0)
    @Max(100)
    advancePercent?: number;

    /** Days from order to delivery, promised to the buyer. Not to be confused
     *  with Product.lead_time_days, which is internal replenishment planning. */
    @IsOptional()
    @IsInt()
    @Min(0)
    deliveryLeadTimeDays?: number;

    @IsOptional()
    @IsString()
    countryOfOrigin?: string;
}

export class CreateQuotationDto extends ProformaTermsDto {
    @IsString()
    storeId: string;

    @IsOptional()
    @IsString()
    customerId?: string;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CreateQuotationItemDto)
    items: CreateQuotationItemDto[];

    @IsNumber()
    totalAmount: number;

    @IsOptional()
    @IsDateString()
    validUntil?: string;

    @IsOptional()
    @IsString()
    notes?: string;
}

export class UpdateQuotationDto extends ProformaTermsDto {
    @IsOptional()
    @IsString()
    customerId?: string;

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CreateQuotationItemDto)
    items?: CreateQuotationItemDto[];

    @IsOptional()
    @IsNumber()
    totalAmount?: number;

    @IsOptional()
    @IsDateString()
    validUntil?: string;

    @IsOptional()
    @IsString()
    notes?: string;
}

export class UpdateQuotationStatusDto {
    @IsString()
    status: string;
}
