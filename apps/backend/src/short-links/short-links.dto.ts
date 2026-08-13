import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateShortLinkDto {
    @IsString()
    @MinLength(1)
    @MaxLength(2048)
    target_url!: string;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    label?: string;
}

/**
 * What the `/s/<code>` redirect handler forwards about the visitor when it counts
 * a click.
 *
 * The handler is a server-side route inside Next, so by the time the request
 * reaches this API the original visitor's headers are gone — they have to travel
 * explicitly. Everything is optional and nothing is required to resolve the link:
 * a click with no context is still a click, and refusing one for a missing header
 * would break the redirect over telemetry.
 *
 * The IP is deliberately *not* a field here. It arrives as `X-Forwarded-For` and
 * is read off the request, so a body cannot claim to be an address it is not — a
 * weak guarantee on a public endpoint, but a free one.
 *
 * Limits mirror `click-context.ts`; the pipe rejects grossly oversized headers
 * before they reach the parser.
 */
export class TrackShortLinkClickDto {
    @IsOptional()
    @IsString()
    @MaxLength(4096)
    referrer?: string;

    @IsOptional()
    @IsString()
    @MaxLength(2048)
    user_agent?: string;

    /** Query string of the `/s/<code>` URL itself — where utm tags arrive. */
    @IsOptional()
    @IsString()
    @MaxLength(4096)
    query?: string;

    /** Raw `Accept-Language`. */
    @IsOptional()
    @IsString()
    @MaxLength(512)
    language?: string;

    /** Two-letter code from a CDN/proxy geo header, when the edge provides one. */
    @IsOptional()
    @IsString()
    @MaxLength(16)
    country?: string;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    city?: string;
}
