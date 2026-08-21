import {
    ArrayMaxSize,
    ArrayNotEmpty,
    IsArray,
    IsBoolean,
    IsIn,
    IsInt,
    IsISO8601,
    IsOptional,
    IsString,
    MaxLength,
    MinLength,
    ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { BLOG_AUDIENCES, BLOG_STATUSES } from './blog-status';

const trim = ({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value;

/** Locales a translation may be written in — mirrors the frontend registry. */
export const BLOG_LOCALES = ['en', 'bn', 'ms'] as const;

export class BlogTranslationDto {
    @IsIn(BLOG_LOCALES as unknown as string[])
    locale!: string;

    @IsString()
    @MinLength(1)
    @MaxLength(200)
    title!: string;

    @IsOptional()
    @IsString()
    @MaxLength(400)
    excerpt?: string;

    @IsString()
    @MaxLength(200_000)
    body_md!: string;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    seo_title?: string;

    @IsOptional()
    @IsString()
    @MaxLength(400)
    seo_description?: string;
}

export class UpsertBlogPostDto {
    @IsOptional()
    @IsString()
    @MaxLength(120)
    slug?: string;

    @IsOptional()
    @IsIn(BLOG_STATUSES as unknown as string[])
    status?: string;

    @IsOptional()
    @IsIn(BLOG_AUDIENCES as unknown as string[])
    audience?: string;

    @IsOptional()
    @IsString()
    category_id?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    cover_alt?: string;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    author_name?: string;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    author_title?: string;

    @IsOptional()
    @IsISO8601()
    scheduled_for?: string | null;

    @IsOptional()
    @IsBoolean()
    featured?: boolean;

    /** Marks a revision as substantive, which is what readers see as "Updated". */
    @IsOptional()
    @IsBoolean()
    mark_edited?: boolean;

    /**
     * Full replacement of the post's copy. Locales absent from the array are
     * deleted, which is how a translation is removed — there is no separate
     * endpoint for it, and a partial merge would leave no way to.
     */
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => BlogTranslationDto)
    translations!: BlogTranslationDto[];
}

export class UpsertBlogCategoryDto {
    @IsOptional()
    @IsString()
    @MaxLength(80)
    slug?: string;

    @IsString()
    @MinLength(1)
    @MaxLength(80)
    name_en!: string;

    @IsOptional()
    @IsString()
    @MaxLength(80)
    name_bn?: string;

    @IsOptional()
    @IsString()
    @MaxLength(80)
    name_ms?: string;

    @IsOptional()
    @IsInt()
    sort_order?: number;
}

export class PublishBlogPostDto {
    /** Omitted means "now". Used by the editor's "publish at" control. */
    @IsOptional()
    @IsISO8601()
    published_at?: string;
}

/**
 * The editors' AI Assistant request. Shared by the platform and tenant blogs —
 * a shop writes in one language and sends its own locale, the platform editor
 * sends every language tab it wants filled.
 */
export class BlogAiDraftDto {
    @Transform(trim)
    @IsString()
    @MinLength(1)
    @MaxLength(2000)
    prompt!: string;

    /** Single-language callers (the shop editor). Ignored when `locales` is set. */
    @IsOptional()
    @IsIn(BLOG_LOCALES as unknown as string[])
    locale?: string;

    /**
     * Every language the post should come back in. The first is written from
     * the brief and the rest are translated from it, so one request produces
     * one article rather than three unrelated ones sharing a slug.
     */
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(BLOG_LOCALES.length)
    @IsIn(BLOG_LOCALES as unknown as string[], { each: true })
    locales?: string[];
}

/**
 * Translate copy the author already has instead of generating a second article
 * about the same subject.
 *
 * The copy travels in the request rather than being read from the post,
 * because the editor's unsaved edits are what the author means by "this
 * article" — requiring a save first would make the button useless mid-draft.
 */
export class BlogAiTranslateDto {
    @IsIn(BLOG_LOCALES as unknown as string[])
    source_locale!: string;

    @IsArray()
    @ArrayNotEmpty()
    @ArrayMaxSize(BLOG_LOCALES.length)
    @IsIn(BLOG_LOCALES as unknown as string[], { each: true })
    target_locales!: string[];

    @Transform(trim)
    @IsString()
    @MinLength(1)
    @MaxLength(200)
    title!: string;

    @Transform(trim)
    @IsString()
    @MinLength(1)
    @MaxLength(200_000)
    body_md!: string;

    @IsOptional()
    @IsString()
    @MaxLength(400)
    excerpt?: string;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    seo_title?: string;

    @IsOptional()
    @IsString()
    @MaxLength(400)
    seo_description?: string;
}
