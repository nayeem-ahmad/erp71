import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ImageResponse } from 'next/og';

import { BRAND_FULL_NAME, BRAND_TAGLINE } from '../lib/brand';

export const alt = BRAND_FULL_NAME;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * The social card every marketing, blog and careers link falls back to.
 *
 * Composed at build time from the brand lockup rather than kept as a checked-in
 * PNG, so a logo change doesn't leave a stale card behind.
 */
export default async function OpengraphImage() {
    const logo = await readFile(join(process.cwd(), 'public', 'logo', 'logo.png'));
    const logoSrc = `data:image/png;base64,${logo.toString('base64')}`;

    return new ImageResponse(
        (
            <div
                style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 48,
                    backgroundColor: '#ffffff',
                    // Matches the theme colour in the manifest and viewport.
                    borderBottom: '24px solid #2563eb',
                }}
            >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={logoSrc} alt="" width={660} height={260} />
                <div style={{ display: 'flex', fontSize: 38, color: '#4b5563', letterSpacing: -0.5 }}>
                    {BRAND_TAGLINE}
                </div>
            </div>
        ),
        size,
    );
}
