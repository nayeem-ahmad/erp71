import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { BLOG_STATUSES } from '../blog/blog-status';

export class UpsertTenantBlogPostDto {
    @IsString()
    @MinLength(1)
    @MaxLength(200)
    title!: string;

    @IsString()
    @MaxLength(200_000)
    body_md!: string;

    @IsOptional()
    @IsString()
    @MaxLength(400)
    excerpt?: string;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    slug?: string;

    @IsOptional()
    @IsString()
    category_id?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    seo_title?: string;

    @IsOptional()
    @IsString()
    @MaxLength(400)
    seo_description?: string;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    cover_alt?: string;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    author_name?: string;

    @IsOptional()
    @IsISO8601()
    scheduled_for?: string | null;

    @IsOptional()
    @IsBoolean()
    featured?: boolean;

    @IsOptional()
    @IsBoolean()
    mark_edited?: boolean;
}

export class TenantBlogStatusDto {
    @IsIn(BLOG_STATUSES as unknown as string[])
    status!: string;
}

export class UpsertTenantBlogCategoryDto {
    @IsString()
    @MinLength(1)
    @MaxLength(80)
    name!: string;

    @IsOptional()
    @IsString()
    @MaxLength(80)
    slug?: string;

    @IsOptional()
    @IsInt()
    sort_order?: number;
}

export class UpdateTenantBlogSettingsDto {
    @IsOptional()
    @IsBoolean()
    enabled?: boolean;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    title?: string;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    tagline?: string;
}

export class PublishTenantBlogPostDto {
    @IsOptional()
    @IsISO8601()
    published_at?: string;
}
