import { Transform } from 'class-transformer';
import {
    ArrayNotEmpty,
    IsArray,
    IsBoolean,
    IsIn,
    IsObject,
    IsOptional,
    IsString,
    MaxLength,
    MinLength,
    ValidateIf,
} from 'class-validator';
import { PERSON_SECTIONS, type PersonSectionKey } from '@erp71/shared-types';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * `sections` is a free-form object on purpose: the service normalises each
 * section with `normalizeSectionPartial`, and nested DTO classes would have the
 * global whitelist pipe strip or reject its fields.
 */
export class CreatePreferenceProfileDto {
    @Transform(trim)
    @IsString()
    @MinLength(1)
    @MaxLength(60)
    name!: string;

    @IsOptional()
    @IsBoolean()
    is_default?: boolean;

    @IsOptional()
    @IsObject()
    sections?: Record<string, unknown>;
}

export class UpdatePreferenceProfileDto {
    @IsOptional()
    @Transform(trim)
    @IsString()
    @MinLength(1)
    @MaxLength(60)
    name?: string;

    @IsOptional()
    @IsBoolean()
    is_default?: boolean;

    /** A key set to `null` removes that section; any other value replaces it. */
    @IsOptional()
    @IsObject()
    sections?: Record<string, unknown | null>;
}

export class ApplyPreferenceProfileDto {
    @IsArray()
    @ArrayNotEmpty()
    @IsIn(PERSON_SECTIONS, { each: true })
    sections!: PersonSectionKey[];

    /**
     * Omitted means everyone the profile reaches. `null` is refused rather than
     * read as omitted (which `@IsOptional` would do): it would quietly widen a
     * targeted apply to every member.
     */
    @ValidateIf((_, value) => value !== undefined)
    @IsArray()
    @IsString({ each: true })
    user_ids?: string[];
}
