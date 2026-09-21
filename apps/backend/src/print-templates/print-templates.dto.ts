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
    /// Separate from QUOTE: a proforma carries commercial terms and beneficiary
    /// bank details a quote does not, so a tenant will usually want a different
    /// template assigned to it.
    PROFORMA_INVOICE = 'PROFORMA_INVOICE',
    VOUCHER = 'VOUCHER',
    MONEY_RECEIPT = 'MONEY_RECEIPT',
    SALES_ORDER = 'SALES_ORDER',
    SALES_RETURN = 'SALES_RETURN',
    /// The delivery challan that rides with the goods. Same letterhead family
    /// as the invoice, but a tenant usually wants a plainer one on the copy a
    /// rider carries, so it gets its own assignable type.
    DELIVERY_CHALLAN = 'DELIVERY_CHALLAN',
    PURCHASE_ORDER = 'PURCHASE_ORDER',
    PURCHASE_RETURN = 'PURCHASE_RETURN',
    LIST_REPORT = 'LIST_REPORT',
    /// HRIS Phase 6. A payslip carries the same tenant letterhead as an
    /// invoice, so it belongs in the existing template family rather than
    /// getting a print path of its own.
    PAYSLIP = 'PAYSLIP',
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
const TITLE_POSITIONS = [
    'above-left',
    'above-center',
    'above-right',
    'beside-left',
    'beside-right',
    'below-left',
    'below-center',
    'below-right',
] as const;

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

    /** Absent means uncapped — the logo takes the width its ratio asks for. */
    @IsOptional()
    @IsNumber()
    @Min(5)
    @Max(250)
    maxWidthMm?: number;

    /** Size by width instead of height; `heightMm` is then ignored. */
    @IsOptional()
    @IsBoolean()
    fullWidth?: boolean;

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

    /**
     * Where the title block sits. Absent on configs stored before the control
     * existed — the renderer then derives it from the layout, so they keep
     * printing as they did.
     */
    @IsOptional()
    @IsIn(TITLE_POSITIONS)
    position?: (typeof TITLE_POSITIONS)[number];

    /** Nudge from the slot, in mm. Negative moves left/up. */
    @IsOptional()
    @IsNumber()
    @Min(-100)
    @Max(100)
    offsetXMm?: number;

    @IsOptional()
    @IsNumber()
    @Min(-100)
    @Max(100)
    offsetYMm?: number;
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
    @IsBoolean()
    underline?: boolean;

    @IsOptional()
    @IsIn(ALIGNMENTS)
    align?: (typeof ALIGNMENTS)[number];

    @IsOptional()
    @IsHexColor()
    color?: string;

    @IsOptional()
    @IsIn(FONT_FAMILIES)
    fontFamily?: (typeof FONT_FAMILIES)[number];

    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(10)
    letterSpacingPx?: number;
}

/**
 * An image on the letterhead beyond the logo — signature, seal, badge, QR.
 *
 * `url` is optional on purpose: an entry with only a caption prints a blank
 * signature line for someone to sign by hand.
 */
export class TemplateImageDto {
    @IsOptional()
    @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
    @MaxLength(2048)
    url?: string;

    @IsNumber()
    @Min(3)
    @Max(60)
    heightMm: number;

    @IsOptional()
    @IsIn(ALIGNMENTS)
    align?: (typeof ALIGNMENTS)[number];

    @IsOptional()
    @IsString()
    @MaxLength(120)
    caption?: string;

    @IsOptional()
    @IsBoolean()
    showOnThermal?: boolean;

    /**
     * Stretch across the whole band, sized by width. `heightMm` no longer
     * constrains it — the height follows the aspect ratio.
     */
    @IsOptional()
    @IsBoolean()
    fullWidth?: boolean;
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

/** The tenant-designed footer band. */
export class PrintFooterConfigDto {
    @IsBoolean()
    show: boolean;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => HeaderLineDto)
    lines: HeaderLineDto[];

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => TemplateImageDto)
    images: TemplateImageDto[];

    @ValidateNested()
    @Type(() => HeaderRuleDto)
    rule: HeaderRuleDto;

    @IsNumber()
    @Min(0)
    @Max(30)
    spacingMm: number;

    @IsBoolean()
    repeatOnEveryPage: boolean;

    /**
     * Sit on the page's bottom edge rather than directly under the content.
     * Needs `repeatOnEveryPage` — the renderer ignores it otherwise.
     */
    @IsOptional()
    @IsBoolean()
    pinToPageBottom?: boolean;

    /** Run past the page margin to the paper edge. */
    @IsOptional()
    @IsBoolean()
    bleed?: boolean;
}

export class PrintHeaderConfigDto {
    /**
     * 1 — header only. 2 — adds `images` and `footer`. 3 — adds logo width,
     * title placement and footer pinning/bleed. All are accepted; the fields a
     * version predates are optional and default to what it already printed.
     */
    @IsInt()
    @IsIn([1, 2, 3])
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

    /** Absent on stored v1 configs — the renderer defaults it to empty. */
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => TemplateImageDto)
    images?: TemplateImageDto[];

    @ValidateNested()
    @Type(() => HeaderRuleDto)
    rule: HeaderRuleDto;

    /** Absent on stored v1 configs — no footer prints until one is designed. */
    @IsOptional()
    @ValidateNested()
    @Type(() => PrintFooterConfigDto)
    footer?: PrintFooterConfigDto;

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
