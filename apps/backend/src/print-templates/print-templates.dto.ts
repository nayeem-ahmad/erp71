import { Type } from 'class-transformer';
import {
    IsArray,
    IsBoolean,
    IsEnum,
    IsHexColor,
    IsIn,
    IsInt,
    IsNotEmpty,
    IsNumber,
    IsObject,
    IsOptional,
    IsString,
    IsUrl,
    Max,
    MaxLength,
    Min,
    ValidateNested,
} from 'class-validator';

/** Document families a template can be assigned to. */
export enum PrintDocType {
    SALES_INVOICE = 'SALES_INVOICE',
    POS_RECEIPT = 'POS_RECEIPT',
    QUOTE = 'QUOTE',
    VOUCHER = 'VOUCHER',
    MONEY_RECEIPT = 'MONEY_RECEIPT',
    SALES_ORDER = 'SALES_ORDER',
    SALES_RETURN = 'SALES_RETURN',
    PURCHASE_ORDER = 'PURCHASE_ORDER',
    PURCHASE_RETURN = 'PURCHASE_RETURN',
    LIST_REPORT = 'LIST_REPORT',
}

export enum PaperSize {
    A4 = 'A4',
    A5 = 'A5',
    Letter = 'Letter',
    Thermal80 = 'Thermal80',
    Thermal58 = 'Thermal58',
}

const LAYOUTS = ['logo-left', 'logo-right', 'logo-center', 'logo-above', 'text-only'] as const;
const FONT_FAMILIES = ['sans', 'serif', 'mono', 'bengali'] as const;
const ALIGNMENTS = ['left', 'center', 'right'] as const;

/*
 * The config mirrors PrintHeaderConfig in the frontend's lib/print/types.ts —
 * the renderer there is the contract. Everything is validated rather than
 * stored as opaque JSON so a bad payload cannot reach the print window.
 */

export class HeaderLogoDto {
    @IsOptional()
    @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
    @MaxLength(2048)
    url?: string;

    @IsNumber()
    @Min(3)
    @Max(60)
    heightMm: number;

    @IsBoolean()
    showOnThermal: boolean;
}

export class HeaderCompanyDto {
    @IsBoolean()
    show: boolean;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    nameOverride?: string;

    @IsNumber()
    @Min(6)
    @Max(48)
    fontSizePt: number;

    @IsBoolean()
    bold: boolean;

    @IsHexColor()
    color: string;
}

export class HeaderTitleDto {
    @IsBoolean()
    show: boolean;

    @IsNumber()
    @Min(6)
    @Max(48)
    fontSizePt: number;

    @IsBoolean()
    uppercase: boolean;

    @IsInt()
    @Min(0)
    @Max(10)
    letterSpacingPx: number;

    @IsHexColor()
    color: string;
}

export class HeaderLineDto {
    @IsString()
    @MaxLength(300)
    text: string;

    @IsOptional()
    @IsNumber()
    @Min(5)
    @Max(48)
    fontSizePt?: number;

    @IsOptional()
    @IsBoolean()
    bold?: boolean;

    @IsOptional()
    @IsBoolean()
    italic?: boolean;

    @IsOptional()
    @IsIn(ALIGNMENTS)
    align?: (typeof ALIGNMENTS)[number];

    @IsOptional()
    @IsHexColor()
    color?: string;
}

export class HeaderRuleDto {
    @IsBoolean()
    show: boolean;

    @IsNumber()
    @Min(0)
    @Max(8)
    thicknessPx: number;

    @IsHexColor()
    color: string;
}

export class PrintHeaderConfigDto {
    @IsInt()
    @IsIn([1])
    version: number;

    @IsIn(LAYOUTS)
    layout: (typeof LAYOUTS)[number];

    @ValidateNested()
    @Type(() => HeaderLogoDto)
    logo: HeaderLogoDto;

    @ValidateNested()
    @Type(() => HeaderCompanyDto)
    company: HeaderCompanyDto;

    @ValidateNested()
    @Type(() => HeaderTitleDto)
    title: HeaderTitleDto;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => HeaderLineDto)
    lines: HeaderLineDto[];

    @ValidateNested()
    @Type(() => HeaderRuleDto)
    rule: HeaderRuleDto;

    @IsIn(FONT_FAMILIES)
    fontFamily: (typeof FONT_FAMILIES)[number];

    @IsNumber()
    @Min(5)
    @Max(24)
    baseFontSizePt: number;

    @IsNumber()
    @Min(0)
    @Max(30)
    spacingMm: number;

    /**
     * Per-paper-size overrides. Validated as an object rather than a nested
     * config because every field inside is optional — the renderer clamps and
     * sanitises each value it uses.
     */
    @IsOptional()
    @IsObject()
    perPaper?: Record<string, unknown>;
}

export class CreatePrintTemplateDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(80)
    name: string;

    @IsOptional()
    @IsBoolean()
    is_default?: boolean;

    @IsOptional()
    @IsArray()
    @IsEnum(PrintDocType, { each: true })
    doc_types?: PrintDocType[];

    @ValidateNested()
    @Type(() => PrintHeaderConfigDto)
    config: PrintHeaderConfigDto;
}

export class UpdatePrintTemplateDto {
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    @MaxLength(80)
    name?: string;

    @IsOptional()
    @IsBoolean()
    is_default?: boolean;

    @IsOptional()
    @IsArray()
    @IsEnum(PrintDocType, { each: true })
    doc_types?: PrintDocType[];

    @IsOptional()
    @ValidateNested()
    @Type(() => PrintHeaderConfigDto)
    config?: PrintHeaderConfigDto;
}

export class ResolvePrintTemplateQueryDto {
    @IsOptional()
    @IsEnum(PrintDocType)
    docType?: PrintDocType;
}

export interface PrintTemplateResponseDto {
    id: string;
    tenant_id: string;
    name: string;
    is_default: boolean;
    doc_types: string[];
    config: Record<string, unknown>;
    created_at: Date;
    updated_at: Date;
}

export interface ResolvedPrintTemplateDto {
    /** Null when no template is stored and branding defaults were used. */
    template_id: string | null;
    name: string | null;
    config: Record<string, unknown>;
}
