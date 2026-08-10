import { parseSpreadsheetFile, autoMapHeaders } from './spreadsheet';

const csvFile = (body: string, name = 'list.csv') =>
    new File([body], name, { type: 'text/csv' });

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
