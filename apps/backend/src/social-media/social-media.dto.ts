import {
    ArrayMaxSize,
    IsArray,
    IsIn,
    IsISO8601,
    IsOptional,
    IsString,
    IsUrl,
    MaxLength,
    MinLength,
} from 'class-validator';
import { BUFFER_POST_MODES } from './buffer.service';
import { SOCIAL_NETWORKS, SOCIAL_POST_STATUSES } from './social-media-status';

/**
 * Longest copy any target network accepts, so the field is not the thing that
 * rejects a post. Per-network limits (280 on X, 2 200 on Instagram) are shown as
 * a hint in the composer instead of enforced here: which limit applies depends
 * on which Buffer channel the operator picks at push time, which is not known
 * when the draft is saved.
 */
const MAX_CONTENT = 5_000;

export class UpsertSocialPostDto {
    @IsOptional()
    @IsString()
    @MaxLength(160)
    title?: string;

    @IsString()
    @MinLength(1)
    @MaxLength(MAX_CONTENT)
    content!: string;

    @IsOptional()
    @IsString()
    @MaxLength(2_000)
    @IsUrl({ require_protocol: true })
    link_url?: string | null;

    /** Buffer fetches this itself, so a private or signed URL will not work. */
    @IsOptional()
    @IsString()
    @MaxLength(2_000)
    @IsUrl({ require_protocol: true })
    image_url?: string | null;

    @IsOptional()
    @IsArray()
    @ArrayMaxSize(SOCIAL_NETWORKS.length)
    @IsIn(SOCIAL_NETWORKS as unknown as string[], { each: true })
    networks?: string[];

    @IsOptional()
    @IsISO8601()
    scheduled_for?: string | null;

    @IsOptional()
    @IsIn(SOCIAL_POST_STATUSES as unknown as string[])
    status?: string;
}

export class PushSocialPostDto {
    /**
     * Buffer channel ids. Empty means "the default Facebook channel from
     * platform settings" — the one-click path the Push button uses.
     */
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(20)
    @IsString({ each: true })
    channel_ids?: string[];

    @IsOptional()
    @IsIn(BUFFER_POST_MODES as unknown as string[])
    mode?: string;

    /** Only read by `customScheduled`; defaults to the post's `scheduled_for`. */
    @IsOptional()
    @IsISO8601()
    due_at?: string | null;
}
