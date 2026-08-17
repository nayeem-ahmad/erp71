import type { MetadataRoute } from 'next';

import { BRAND_NAME, BRAND_TAGLINE } from '../lib/brand';

export default function manifest(): MetadataRoute.Manifest {
    return {
        name: `${BRAND_NAME} — বাংলাদেশ রিটেইল ম্যানেজমেন্ট`,
        short_name: BRAND_NAME,
        description: BRAND_TAGLINE,
        start_url: '/dashboard',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#2563eb',
        orientation: 'portrait-primary',
        icons: [
            { src: '/logo/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/logo/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            // Android crops any icon without a maskable entry into a circle and
            // clips the mark; declaring the 512 as maskable keeps it inside the
            // safe zone instead.
            { src: '/logo/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // The employee self-service portal is the screen most people who
        // install this on a phone are actually here for — a long-press shortcut
        // saves them navigating a staff app they have no permissions for.
        shortcuts: [
            {
                name: 'My workspace',
                short_name: 'My workspace',
                description: 'Check in, apply for leave, view payslips',
                url: '/my',
            },
        ],
    };
}
