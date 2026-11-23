import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsBoolean,
    IsInt,
    IsNumber,
    IsObject,
    IsOptional,
    IsString,
    MaxLength,
    Min,
    ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/** At most this many products in one family — a size run times a colour run, with room to spare. */
export const MAX_FAMILY_MEMBERS = 200;

export class ProductFamilyMemberDto {
    @IsString()
    productId: string;

    /** The product's value on each of the family's options: `{ "Size": "M" }`. */
    @IsObject()
    optionValues: Record<string, string>;
}

export class CreateProductFamilyDto {
    @IsString()
    @MaxLength(200)
    name: string;

    @IsOptional()
    @IsString()
    description?: string;

    @IsOptional()
    @IsString()
    imageUrl?: string;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    imagesGallery?: string[];

    @IsOptional()
    @IsBoolean()
    isFeatured?: boolean;

    @IsArray()
    @IsString({ each: true })
    optionNames: string[];

    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(MAX_FAMILY_MEMBERS)
    @ValidateNested({ each: true })
    @Type(() => ProductFamilyMemberDto)
    members: ProductFamilyMemberDto[];
}

export class UpdateProductFamilyDto {
    @IsOptional()
    @IsString()
    @MaxLength(200)
    name?: string;

    @IsOptional()
    @IsString()
    description?: string;

    @IsOptional()
    @IsString()
    imageUrl?: string;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    imagesGallery?: string[];

    @IsOptional()
    @IsBoolean()
    isFeatured?: boolean;

    /** Sent together with `members`: the two are validated as one. */
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    optionNames?: string[];

    /**
     * The family's whole membership. A product missing from it leaves the
     * family; one added joins it. Omit to leave membership as it is.
     */
    @IsOptional()
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(MAX_FAMILY_MEMBERS)
    @ValidateNested({ each: true })
    @Type(() => ProductFamilyMemberDto)
    members?: ProductFamilyMemberDto[];
}

/** One new product the variant generator makes. */
export class GeneratedVariantDto {
    /** Its values on the family's options: `{ "Size": "XL" }`. */
    @IsObject()
    optionValues: Record<string, string>;

    @IsOptional()
    @IsString()
    @MaxLength(100)
    sku?: string;

    @IsNumber()
    @Min(0)
    price: number;

    @IsOptional()
    @IsInt()
    @Min(0)
    initialStock?: number;

    /** Unit cost of the opening stock. Defaults to the base product's average cost. */
    @IsOptional()
    @IsNumber()
    @Min(0)
    cost?: number;
}

/** At most this many products made in one go. */
export const MAX_GENERATED_VARIANTS = 100;

/**
 * "Create variants": new products made from a base product, one per
 * combination, grouped into a family. When the base is already in a family
 * the new products join it, on its options; otherwise a family is made,
 * named `name`, on `optionNames`, and the base joins it as
 * `baseOptionValues` if that is given (else it stays a product on its own and
 * only served as the template).
 */
export class GenerateVariantsDto {
    @IsString()
    baseProductId: string;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    name?: string;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    optionNames?: string[];

    @IsOptional()
    @IsObject()
    baseOptionValues?: Record<string, string>;

    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(MAX_GENERATED_VARIANTS)
    @ValidateNested({ each: true })
    @Type(() => GeneratedVariantDto)
    variants: GeneratedVariantDto[];
}
