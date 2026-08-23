'use client';

/**
 * Up to two initials for the fallback circle. Two, not more: at 32px a third
 * letter is unreadable, and the point is to be recognisable at a glance in a
 * list row rather than to encode the whole name.
 */
export function initialsOf(name: string): string {
    const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return parts
        .slice(0, 2)
        .map((part) => part[0])
        .join('')
        .toUpperCase();
}

const SIZES = {
    sm: 'w-8 h-8 text-xs',
    lg: 'w-16 h-16 text-lg',
} as const;

type AvatarProps = {
    src?: string | null;
    name: string;
    size?: keyof typeof SIZES;
    className?: string;
};

/**
 * A person's photo, or their initials when there is none. Purely
 * presentational — uploading lives in `PhotoField`.
 */
export default function Avatar({
    src,
    name,
    size = 'sm',
    className = '',
}: Readonly<AvatarProps>) {
    const dimensions = SIZES[size];

    if (src) {
        // eslint-disable-next-line @next/next/no-img-element -- Cloudinary URLs
        // are not in next.config's remotePatterns, and a 32px list avatar gains
        // nothing from the optimiser.
        return (
            <img
                src={src}
                alt={name}
                className={`${dimensions} rounded-full object-cover flex-shrink-0 bg-gray-100 ${className}`}
            />
        );
    }

    return (
        <span
            aria-hidden="true"
            className={`${dimensions} rounded-full flex-shrink-0 inline-flex items-center justify-center bg-blue-50 text-blue-700 font-semibold ${className}`}
        >
            {initialsOf(name)}
        </span>
    );
}
