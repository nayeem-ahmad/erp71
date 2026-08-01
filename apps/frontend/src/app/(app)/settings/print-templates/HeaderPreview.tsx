'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { buildPrintDocument, isThermalPaper, renderHeaderHtml } from '@/lib/print';
import type { HeaderContext, PaperSize, PrintHeaderConfig } from '@/lib/print';

/** Paper widths/heights at 96dpi — the preview renders at true size, then scales. */
const PAPER_PX: Record<PaperSize, { width: number; height: number }> = {
    A4: { width: 794, height: 1123 },
    A5: { width: 559, height: 794 },
    Letter: { width: 816, height: 1056 },
    Thermal80: { width: 302, height: 640 },
    Thermal58: { width: 219, height: 640 },
};

interface HeaderPreviewProps {
    config: PrintHeaderConfig;
    paperSize: PaperSize;
    /** Sample values the header's tokens are rendered with. */
    context: HeaderContext;
    bodyLabel: string;
}

export default function HeaderPreview({ config, paperSize, context, bodyLabel }: HeaderPreviewProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [scale, setScale] = useState(1);
    const paper = PAPER_PX[paperSize];

    // Render at real paper width and scale down to whatever space the panel has,
    // so proportions match the printed page instead of reflowing.
    useEffect(() => {
        const element = containerRef.current;
        if (!element || typeof ResizeObserver === 'undefined') return;

        const fit = () => setScale(Math.min(1, element.clientWidth / paper.width));
        fit();

        const observer = new ResizeObserver(fit);
        observer.observe(element);
        return () => observer.disconnect();
    }, [paper.width]);

    const srcDoc = useMemo(() => {
        const headerHtml = renderHeaderHtml(config, context, paperSize);
        const bodyHtml = `<p style="color:#9ca3af;font-size:${isThermalPaper(paperSize) ? '10' : '12'}px">${bodyLabel}</p>`;

        return buildPrintDocument({
            title: 'preview',
            paperSize,
            headerConfig: config,
            headerHtml,
            bodyHtml,
        });
    }, [config, context, paperSize, bodyLabel]);

    return (
        <div ref={containerRef} className="w-full overflow-x-auto">
            <div style={{ height: paper.height * scale }}>
                <iframe
                    title="Print header preview"
                    sandbox=""
                    srcDoc={srcDoc}
                    className="border border-gray-200 bg-white"
                    style={{
                        width: paper.width,
                        height: paper.height,
                        transform: `scale(${scale})`,
                        transformOrigin: 'top left',
                    }}
                />
            </div>
        </div>
    );
}
