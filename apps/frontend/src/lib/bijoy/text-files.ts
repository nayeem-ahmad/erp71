/**
 * Reading and writing the files a Bijoy user actually has.
 *
 * Bijoy text predates Unicode: a .txt or .csv saved from it is Windows-1252
 * bytes, one byte per glyph, and reading it as UTF-8 turns `‡` and `©` into
 * replacement characters before the converter ever sees them. A file is
 * therefore read as UTF-8 only when it really is UTF-8, and as Windows-1252
 * otherwise; and Bijoy output is written back as Windows-1252, so a font like
 * SutonnyMJ in Excel or Word shows it as Bangla again.
 */

/** Windows-1252's 0x80–0x9F block, which is where it differs from Latin-1. */
const CP1252_HIGH: Record<number, number> = {
    0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
    0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91,
    0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98,
    0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

/** Bytes as text: UTF-8 when they decode cleanly as UTF-8, Windows-1252 otherwise. */
export function decodeTextBytes(bytes: Uint8Array): { text: string; encoding: 'utf-8' | 'windows-1252' } {
    // A UTF-8 byte-order mark settles it.
    const hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(hasBom ? bytes.subarray(3) : bytes);
        return { text, encoding: 'utf-8' };
    } catch {
        return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
    }
}

/** Text as Windows-1252 bytes. A character it cannot hold becomes `?`, as Windows itself does. */
export function encodeWindows1252(text: string): Uint8Array {
    const out = new Uint8Array(text.length);
    let length = 0;
    for (const char of text) {
        const code = char.codePointAt(0)!;
        if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) out[length++] = code;
        else out[length++] = CP1252_HIGH[code] ?? 0x3f;
    }
    return out.subarray(0, length);
}

/** UTF-8 with a byte-order mark, which is what makes Excel open a Bangla CSV as Bangla. */
export function encodeUtf8WithBom(text: string): Uint8Array {
    const body = new TextEncoder().encode(text);
    const out = new Uint8Array(body.length + 3);
    out.set([0xef, 0xbb, 0xbf]);
    out.set(body, 3);
    return out;
}

/** Saves bytes as a file through the browser. */
export function downloadBytes(bytes: Uint8Array, fileName: string, mimeType: string): void {
    const blob = new Blob([bytes as BlobPart], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** `price-list.csv` → `price-list-unicode.csv`. */
export function convertedFileName(name: string, suffix: string): string {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? `${name.slice(0, dot)}-${suffix}${name.slice(dot)}` : `${name}-${suffix}.txt`;
}
