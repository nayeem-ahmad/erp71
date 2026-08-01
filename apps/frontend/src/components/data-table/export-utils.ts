import type { Table } from '@tanstack/react-table';
import { SIMPLE_DOC_STYLES, openPrintWindow } from '@/lib/print';
import type { DeepPartial, PrintHeaderConfig } from '@/lib/print';

/* --------------------------------------------------------------- */
/*  CSV Export                                                      */
/* --------------------------------------------------------------- */
export function exportToCSV<T>(table: Table<T>, filename: string) {
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
                const str = val == null ? '' : String(val);
                // Escape CSV special chars
                return str.includes(',') || str.includes('"') || str.includes('\n')
                    ? `"${str.replace(/"/g, '""')}"`
                    : str;
            }),
    );

    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    downloadBlob(csv, `${filename}.csv`, 'text/csv;charset=utf-8;');
}

/* --------------------------------------------------------------- */
/*  Excel Export (xlsx)                                              */
/* --------------------------------------------------------------- */
export async function exportToExcel<T>(table: Table<T>, filename: string) {
    const XLSX = await import('xlsx');

    const headers = table
        .getVisibleLeafColumns()
        .filter((c) => c.id !== 'actions' && c.id !== 'select')
        .map((c) => c.columnDef.header as string);

    const data = table.getFilteredRowModel().rows.map((row) => {
        const obj: Record<string, unknown> = {};
        table
            .getVisibleLeafColumns()
            .filter((c) => c.id !== 'actions' && c.id !== 'select')
            .forEach((col) => {
                const header = col.columnDef.header as string;
                obj[header] = row.getValue(col.id) ?? '';
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
export async function exportToPDF<T>(table: Table<T>, filename: string) {
    const { default: jsPDF } = await import('jspdf');
    await import('jspdf-autotable');

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

    const doc = new jsPDF({ orientation: 'landscape' });
    doc.setFontSize(16);
    doc.text(filename, 14, 20);

    (doc as any).autoTable({
        head: [headers],
        body: rows,
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
