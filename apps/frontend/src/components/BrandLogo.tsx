import Image from 'next/image';
import Link from 'next/link';

import { BRAND_NAME } from '@/lib/brand';

/** Full horizontal lockup (mark + wordmark) or the square mark on its own. */
type BrandVariant = 'lockup' | 'mark';

/** `reverse` is the light-on-dark artwork — for blue tiles and photo panels, not a dark theme. */
type BrandTone = 'default' | 'reverse';

type BrandAsset = {
    src: string;
    /** width ÷ height of the artwork, used to derive width from the requested height. */
    ratio: number;
};

const ASSETS: Record<BrandVariant, Record<BrandTone, string>> = {
    lockup: { default: '/logo/logo.svg', reverse: '/logo/reverse-logo.svg' },
    mark: { default: '/logo/icon.svg', reverse: '/logo/reverse-icon.svg' },
};

const RATIOS: Record<BrandVariant, number> = {
    lockup: 2600 / 1024,
    mark: 1,
};

type BrandLogoProps = {
    variant?: BrandVariant;
    tone?: BrandTone;
    /** Rendered height in px; width follows the artwork's aspect ratio. */
    height?: number;
    /** Wraps the logo in a link when set. */
    href?: string;
    className?: string;
    /** Set when a visible wordmark sits beside the logo, so screen readers don't hear the name twice. */
    decorative?: boolean;
    /** Pass for above-the-fold marks (nav, login) to avoid a lazy-load flash. */
    priority?: boolean;
};

/**
 * The ERP71 brand mark. Every surface goes through this component so no page
 * picks its own file path or hardcodes the wordmark as text — the same reason
 * brand strings live in `lib/brand.ts`.
 *
 * Note this is the *platform* logo. Tenant-uploaded branding (`useBranding()`)
 * always takes precedence where both could apply; this is the un-branded fallback.
 */
export default function BrandLogo({
    variant = 'lockup',
    tone = 'default',
    height = 32,
    href,
    className,
    decorative = false,
    priority = false,
}: BrandLogoProps) {
    const asset: BrandAsset = { src: ASSETS[variant][tone], ratio: RATIOS[variant] };
    const width = Math.round(height * asset.ratio);

    const image = (
        <Image
            src={asset.src}
            alt={decorative ? '' : BRAND_NAME}
            width={width}
            height={height}
            className={className}
            priority={priority}
            // The image optimizer rejects SVG unless `dangerouslyAllowSVG` is on
            // globally, which we don't want while tenants can supply their own
            // logo URLs. SVGs gain nothing from optimization anyway.
            unoptimized
        />
    );

    if (!href) return image;

    return (
        <Link href={href} className="inline-flex items-center" aria-label={decorative ? BRAND_NAME : undefined}>
            {image}
        </Link>
    );
}
