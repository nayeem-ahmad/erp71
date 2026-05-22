'use client';

import React from 'react';
import { formatBDT } from '@/lib/format';

interface BarcodeLabelProps {
    productName: string;
    sku: string;
    price: number;
    businessName?: string;
}

/**
 * Generates a cosmetic barcode SVG from a SKU string.
 * Each character contributes 2-3 bars of varying widths based on charCode % 3.
 * Not standards-compliant — decorative only.
 */
function generateBarcodeSvg(sku: string): React.ReactElement {
    const barHeight = 30;
    const totalTargetBars = 60;
    const svgWidth = 150;

    // Build bar widths for each character
    const bars: { width: number; fill: string }[] = [];

    // Always start with a narrow black guard bar
    bars.push({ width: 1, fill: '#000' });
    bars.push({ width: 1, fill: '#fff' }); // gap

    const text = sku || 'SKU';
    // Calculate how many bars to generate per character to hit ~60 total
    const barsPerChar = Math.max(2, Math.floor((totalTargetBars - 4) / text.length));

    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        for (let b = 0; b < barsPerChar; b++) {
            const variant = (code + b) % 3;
            // Alternate black and white bars
            const isBlack = (bars.length % 2 === 0);
            const width = variant === 0 ? 1 : variant === 1 ? 2 : 3;
            bars.push({ width, fill: isBlack ? '#000' : '#fff' });
        }
    }

    // End guard bar
    bars.push({ width: 1, fill: '#000' });
    bars.push({ width: 1, fill: '#000' });

    // Compute total natural width of bars
    const totalNatural = bars.reduce((sum, b) => sum + b.width, 0);
    // Scale factor to fill svgWidth
    const scale = svgWidth / totalNatural;

    // Build rects
    const rects: React.ReactElement[] = [];
    let x = 0;
    bars.forEach((bar, idx) => {
        const scaledWidth = bar.width * scale;
        if (bar.fill === '#000') {
            rects.push(
                <rect
                    key={idx}
                    x={x}
                    y={0}
                    width={scaledWidth}
                    height={barHeight}
                    fill="#000"
                />
            );
        }
        x += scaledWidth;
    });

    return (
        <svg
            width={svgWidth}
            height={barHeight}
            viewBox={`0 0 ${svgWidth} ${barHeight}`}
            xmlns="http://www.w3.org/2000/svg"
            style={{ display: 'block', background: '#fff' }}
        >
            {rects}
        </svg>
    );
}

/**
 * BarcodeLabel renders a single printable shelf/price label.
 * Screen size: ~190px × 114px (2× of 5cm × 3cm at 96dpi).
 * Print size: 5cm × 3cm via @media print styles on the parent page.
 */
export default function BarcodeLabel({ productName, sku, price, businessName }: BarcodeLabelProps) {
    const displaySku = sku || 'NO-SKU';

    return (
        <div
            className="barcode-label"
            style={{
                width: '189px',
                height: '113px',
                border: '1px solid #d1d5db',
                borderRadius: '4px',
                padding: '6px 8px',
                background: '#fff',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                fontFamily: 'system-ui, sans-serif',
                boxSizing: 'border-box',
                overflow: 'hidden',
            }}
        >
            {/* Business name */}
            {businessName && (
                <div
                    style={{
                        fontSize: '8px',
                        color: '#6b7280',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                    }}
                >
                    {businessName}
                </div>
            )}

            {/* Product name */}
            <div
                style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    color: '#111827',
                    lineHeight: 1.2,
                    overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                }}
            >
                {productName}
            </div>

            {/* SKU */}
            <div
                style={{
                    fontSize: '8px',
                    fontFamily: 'monospace',
                    color: '#6b7280',
                    letterSpacing: '0.03em',
                }}
            >
                {displaySku}
            </div>

            {/* Price */}
            <div
                style={{
                    fontSize: '14px',
                    fontWeight: 800,
                    color: '#111827',
                    letterSpacing: '-0.01em',
                }}
            >
                {formatBDT(price)}
            </div>

            {/* Barcode SVG */}
            <div style={{ marginTop: '2px' }}>
                {generateBarcodeSvg(displaySku)}
                <div
                    style={{
                        fontSize: '7px',
                        fontFamily: 'monospace',
                        textAlign: 'center',
                        color: '#374151',
                        marginTop: '1px',
                        letterSpacing: '0.08em',
                    }}
                >
                    {displaySku}
                </div>
            </div>
        </div>
    );
}
