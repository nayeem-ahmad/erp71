'use client';

import { initialsFor } from './types';

const SIZE_CLASS = {
    sm: 'h-8 w-8 text-xs',
    md: 'h-10 w-10 text-sm',
} as const;

/**
 * Avatar with a monogram fallback. Deliberately not `next/image`: these are
 * Cloudinary URLs on an arbitrary host and the sizes are tiny, so the loader
 * would cost more than it saves.
 */
export default function ChatAvatar({
    person,
    size = 'sm',
}: {
    person: { name?: string | null; email?: string | null; avatarUrl?: string | null };
    size?: keyof typeof SIZE_CLASS;
}) {
    const initials = initialsFor(person);

    if (person.avatarUrl) {
        return (
            <img
                src={person.avatarUrl}
                alt=""
                className={`${SIZE_CLASS[size]} shrink-0 rounded-full object-cover`}
            />
        );
    }

    return (
        <span
            aria-hidden="true"
            className={`${SIZE_CLASS[size]} flex shrink-0 items-center justify-center rounded-full bg-blue-100 font-semibold text-blue-700`}
        >
            {initials}
        </span>
    );
}
