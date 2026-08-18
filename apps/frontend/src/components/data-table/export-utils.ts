import type { Column, Table } from '@tanstack/react-table';
import { SIMPLE_DOC_STYLES, openPrintWindow } from '@/lib/print';
import type { DeepPartial, PrintHeaderConfig } from '@/lib/print';

export type ExportColumnSpec<T> = {
    id: string;
    header: string;
    getValue: (record: T) => unknown;
};

export function formatExportValue(val: unknown): string {
    if (val == null) return '';
    if (typeof val === 'object') {
        const named = val as { name?: unknown };
        if (typeof named.name === 'string') return named.name;
        return '';
    }
    return String(val);
}

export function buildCsv(headers: string[], rows: unknown[][]): string {
    const escape = (val: unknown) => {
        const str = formatExportValue(val);
        return str.includes(',') || str.includes('"') || str.includes('\n')
            ? `"${str.replace(/"/g, '""')}"`
            : str;
    };
    return [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
}

export function buildExportMatrix<T>(
    records: T[],
    columns: ExportColumnSpec<T>[],
): { headers: string[]; rows: string[][] } {
    return {
        headers: columns.map((c) => c.header),
        rows: records.map((record) => columns.map((c) => formatExportValue(c.getValue(record)))),
    };
}

export function exportableColumnLabel(column: { id: string; columnDef: { header?: unknown } }): string {
    return typeof column.columnDef.header === 'string' ? column.columnDef.header : column.id;
}

export function isExportableColumnId(id: string): boolean {
    return id !== 'actions' && id !== 'select';
}

export function valueFromColumn<T>(column: Column<T, unknown>, record: T): unknown {
    const def = column.columnDef as { accessorFn?: (row: T, index: number) => unknown; accessorKey?: string };
    if (typeof def.accessorFn === 'function') {
        return def.accessorFn(record, 0);
    }
    const key = def.accessorKey ?? column.id;
    if (key && record && typeof record === 'object' && key in (record as object)) {
        return (record as Record<string, unknown>)[key];
    }
    return '';
}

function matrixFromTable<T>(table: Table<T>): { headers: string[]; rows: string[][] } {
    const columns = table
        .getVisibleLeafColumns()
        .filter((c) => isExportableColumnId(c.id));
    const records = table.getFilteredRowModel().rows.map((row) => row.original);
    return buildExportMatrix(
        records,
        columns.map((c) => ({
            id: c.id,
            header: exportableColumnLabel(c),
            getValue: (record) => {
                const row = table.getFilteredRowModel().rows.find((r) => r.original === record);
                return row ? row.getValue(c.id) : valueFromColumn(c, record);
            },
        })),
    );
}

/* --------------------------------------------------------------- */
/*  CSV Export                                                      */
/* --------------------------------------------------------------- */
export function exportToCSV(filename: string, headers: string[], rows: unknown[][]): void;
export function exportToCSV<T>(table: Table<T>, filename: string): void;
export function exportToCSV<T>(
    tableOrFilename: Table<T> | string,
    filenameOrHeaders?: string | string[],
    maybeRows?: unknown[][],
) {
    const { filename, headers, rows } = resolveExportArgs(tableOrFilename, filenameOrHeaders, maybeRows);
    downloadBlob(buildCsv(headers, rows), `${filename}.csv`, 'text/csv;charset=utf-8;');
}

function resolveExportArgs<T>(
    tableOrFilename: Table<T> | string,
    filenameOrHeaders?: string | string[],
    maybeRows?: unknown[][],
): { filename: string; headers: string[]; rows: unknown[][] } {
    if (typeof tableOrFilename === 'string') {
        return {
            filename: tableOrFilename,
            headers: (filenameOrHeaders as string[]) ?? [],
            rows: maybeRows ?? [],
        };
    }
    const matrix = matrixFromTable(tableOrFilename);
    return { filename: filenameOrHeaders as string, headers: matrix.headers, rows: matrix.rows };
}

/* --------------------------------------------------------------- */
/*  Excel Export (xlsx)                                              */
/* --------------------------------------------------------------- */
export async function exportToExcel(filename: string, headers: string[], rows: unknown[][]): Promise<void>;
export async function exportToExcel<T>(table: Table<T>, filename: string): Promise<void>;
export async function exportToExcel<T>(
    tableOrFilename: Table<T> | string,
    filenameOrHeaders?: string | string[],
    maybeRows?: unknown[][],
) {
    const { filename, headers, rows } = resolveExportArgs(tableOrFilename, filenameOrHeaders, maybeRows);
    const XLSX = await import('xlsx');

    const data = rows.map((row) => {
        const obj: Record<string, unknown> = {};
        headers.forEach((header, i) => {
            obj[header] = formatExportValue(row[i]);
        });
        return obj;
    });

    const ws = XLSX.utils.json_to_sheet(data, { header: headers });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Data');
    XLSX.writeFile(wb, `${filename}.xlsx`);
}

/* --------------------------------------------------------------- */
/*  PDF Export (jspdf + autotable)                                  */
/* --------------------------------------------------------------- */
export async function exportToPDF(filename: string, headers: string[], rows: unknown[][]): Promise<void>;
export async function exportToPDF<T>(table: Table<T>, filename: string): Promise<void>;
export async function exportToPDF<T>(
    tableOrFilename: Table<T> | string,
    filenameOrHeaders?: string | string[],
    maybeRows?: unknown[][],
) {
    const { filename, headers, rows } = resolveExportArgs(tableOrFilename, filenameOrHeaders, maybeRows);
    const { default: jsPDF } = await import('jspdf');
    await import('jspdf-autotable');

    const body = rows.map((row) => row.map((cell) => formatExportValue(cell)));

    const doc = new jsPDF({ orientation: 'landscape' });
    doc.setFontSize(16);
    doc.text(filename, 14, 20);

    (doc as any).autoTable({
        head: [headers],
        body,
        startY: 30,
        styles: { fontSize: 8 },
        headStyles: { fillColor: [37, 99, 235] },
    });

    doc.save(`${filename}.pdf`);
}

/* --------------------------------------------------------------- */
/*  Print                                                           */
/* --------------------------------------------------------------- */
export interface PrintTableHeader {
    /** Markup from `renderHeaderHtml` — the tenant's letterhead. */
    html: string;
    config?: DeepPartial<PrintHeaderConfig>;
}

export function printTable<T>(table: Table<T>, title: string, header?: PrintTableHeader) {
    const headers = table
        .getVisibleLeafColumns()
        .filter((c) => c.id !== 'actions' && c.id !== 'select')
        .map((c) => c.columnDef.header as string);

    const rows = table.getFilteredRowModel().rows.map((row) =>
        table
            .getVisibleLeafColumns()
            .filter((c) => c.id !== 'actions' && c.id !== 'select')
            .map((col) => {
                const val = row.getValue(col.id);
                return val == null ? '' : String(val);
            }),
    );

    openPrintWindow({
        title,
        paperSize: 'A4',
        headerConfig: header?.config,
        headerHtml: header?.html,
        styles: SIMPLE_DOC_STYLES,
        // Reports run long — repeat the letterhead on every page.
        repeatHeader: true,
        bodyHtml: `
<h1>${title}</h1>
<table>
  <thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
  <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
</table>`,
        footerHtml: `<div class="footer">Printed on ${new Date().toLocaleString()}</div>`,
    });
}

/* --------------------------------------------------------------- */
/*  Helper                                                          */
/* --------------------------------------------------------------- */
function downloadBlob(content: string, filename: string, mimeType: string) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
}
