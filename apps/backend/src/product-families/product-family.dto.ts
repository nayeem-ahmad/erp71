import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsBoolean,
    IsObject,
    IsOptional,
    IsString,
    MaxLength,
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
