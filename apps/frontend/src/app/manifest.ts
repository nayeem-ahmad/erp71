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
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
    };
}
