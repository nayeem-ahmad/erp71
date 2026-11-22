/**
 * Convert the text in a CSV without touching its structure.
 *
 * A price list is the usual file: Bangla product names beside prices and
 * codes. Running the whole file through the converter would turn `120` into
 * `১২০` and break the number column, so a cell that is only a number, a
 * date or a code is left alone; every other cell is converted. Quoting is
 * kept exactly as it was.
 */

/** A cell the converter must not touch: digits, separators, a date, a percentage. */
const NUMERIC_CELL = /^[\s\d.,:/\-+%()]*$/;

export function convertCsvText(csv: string, convert: (text: string) => string): string {
    let out = '';
    let field = '';
    let quoted = false;
    let inQuotes = false;
    let atFieldStart = true;

    const flush = () => {
        const converted = NUMERIC_CELL.test(field) ? field : convert(field);
        out += quoted ? `"${converted.replace(/"/g, '""')}"` : converted;
        field = '';
        quoted = false;
        atFieldStart = true;
    };

    for (let i = 0; i < csv.length; i++) {
        const char = csv[i];
        if (inQuotes) {
            if (char === '"') {
                if (csv[i + 1] === '"') {
                    field += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                field += char;
            }
            continue;
        }
        if (char === '"' && atFieldStart) {
            inQuotes = true;
            quoted = true;
            atFieldStart = false;
        } else if (char === ',' || char === ';' || char === '\t') {
            flush();
            out += char;
        } else if (char === '\r' || char === '\n') {
            flush();
            out += char;
        } else {
            field += char;
            atFieldStart = false;
        }
    }
    if (field || quoted || !atFieldStart) flush();
    return out;
}
