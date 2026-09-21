import { parseSpreadsheetFile, autoMapHeaders, listSheetNames } from './spreadsheet';

const csvFile = (body: string, name = 'list.csv') =>
    new File([body], name, { type: 'text/csv' });

/**
 * jsdom's File has no arrayBuffer(), which the xlsx branch needs. Wrap the
 * bytes in a minimal stand-in rather than pulling in a polyfill.
 */
const xlsxFile = (buf: ArrayBuffer, name = 'book.xlsx') => {
    const file = new File([buf as never], name);
    Object.defineProperty(file, 'arrayBuffer', { value: async () => buf });
    return file;
};


describe('parseSpreadsheetFile', () => {
    it('reads headers and rows from a CSV', async () => {
        const result = await parseSpreadsheetFile(
            csvFile('Email,Subject\na@example.com,Hi\nb@example.com,Yo\n'),
        );
        expect(result.headers).toEqual(['Email', 'Subject']);
        expect(result.rows).toEqual([
            { Email: 'a@example.com', Subject: 'Hi' },
            { Email: 'b@example.com', Subject: 'Yo' },
        ]);
    });

    it('skips blank lines', async () => {
        const result = await parseSpreadsheetFile(csvFile('Email\na@example.com\n\n'));
        expect(result.rows).toHaveLength(1);
    });

    it('rejects an unsupported extension', async () => {
        await expect(parseSpreadsheetFile(csvFile('x', 'notes.txt'))).rejects.toThrow(
            'Unsupported file type ".txt". Please upload a .csv or .xlsx file.',
        );
    });

    it('rejects a file with no extension', async () => {
        await expect(parseSpreadsheetFile(csvFile('x', 'noext'))).rejects.toThrow(
            'Unsupported file type',
        );
    });
});

describe('autoMapHeaders', () => {
    const fields = [
        { key: 'email', label: 'Email' },
        { key: 'name', label: 'Name' },
    ];

    it('matches a header to a field by label, ignoring case and padding', () => {
        expect(autoMapHeaders(['  email ', 'Name'], fields)).toEqual({ email: '  email ', name: 'Name' });
    });

    it('matches a header to a field by key', () => {
        expect(autoMapHeaders(['name'], fields)).toEqual({ email: '', name: 'name' });
    });

    it('leaves a field unmapped when no header matches', () => {
        expect(autoMapHeaders(['Phone'], fields)).toEqual({ email: '', name: '' });
    });
});

describe('parseSpreadsheetFile with a named sheet', () => {
    const XLSX = require('xlsx');

    /** A real multi-sheet workbook, built in memory. */
    const workbookWith = (sheets: Record<string, Record<string, string>[]>) => {
        const wb = XLSX.utils.book_new();
        for (const [name, rows] of Object.entries(sheets)) {
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name);
        }
        return xlsxFile(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
    };

    it('reads the named sheet rather than the first', async () => {
        const file = workbookWith({ Products: [{ a: '1' }], Suppliers: [{ a: '2' }] });
        const parsed = await parseSpreadsheetFile(file, 'Suppliers');
        expect(parsed.rows).toEqual([{ a: '2' }]);
    });

    it('still reads the first sheet when no name is given', async () => {
        const file = workbookWith({ Products: [{ a: '1' }], Suppliers: [{ a: '2' }] });
        const parsed = await parseSpreadsheetFile(file);
        expect(parsed.rows).toEqual([{ a: '1' }]);
    });

    it('throws an error naming the sheets it did find', async () => {
        const file = workbookWith({ Products: [{ a: '1' }] });
        await expect(parseSpreadsheetFile(file, 'Nope')).rejects.toThrow(/Products/);
    });

    it('ignores a sheet name for a CSV, which has only one', async () => {
        const parsed = await parseSpreadsheetFile(csvFile('a\n1'), 'Anything');
        expect(parsed.rows).toEqual([{ a: '1' }]);
    });
});

describe('listSheetNames', () => {
    const XLSX = require('xlsx');

    it('returns the workbook sheet names in order', async () => {
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ a: '1' }]), 'Products');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ a: '2' }]), 'Suppliers');
        const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
        expect(await listSheetNames(xlsxFile(buf))).toEqual(['Products', 'Suppliers']);
    });
});
