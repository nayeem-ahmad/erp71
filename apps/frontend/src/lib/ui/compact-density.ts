/** Shared class maps for compact UI density across app modules. */

export type UiDensity = 'comfortable' | 'compact';

export const compactDensity = {
    page: 'overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]',
    pageInner: 'space-y-4',
    pageInnerWide: 'max-w-[1200px] mx-auto space-y-4',
    pageInnerNarrow: 'max-w-[900px] mx-auto space-y-4',

    sectionLabel: 'text-xs font-medium text-gray-500',
    pageTitle: 'text-lg font-bold tracking-tight text-gray-950',
    pageSubtitle: 'text-xs text-gray-500 mt-0.5',

    card: 'rounded-lg border border-gray-200 bg-white p-3 md:p-4 shadow-sm',
    cardFlat: 'rounded-lg border border-gray-100 bg-white p-3',

    statLabel: 'text-xs font-medium text-gray-500',
    statValue: 'text-xl font-bold tracking-tight',

    btnPrimary: 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors',
    btnSecondary: 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors',

    formLabel: 'text-xs font-medium text-gray-500',
    formField: 'w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 transition-all',
    formStack: 'space-y-3',

    modal: 'w-full rounded-xl border border-gray-200 bg-white shadow-2xl',
    modalPadding: 'p-4',
    modalTitle: 'text-base font-bold tracking-tight text-gray-950',

    filterBar: 'bg-white border border-gray-100 rounded-lg p-3 flex flex-wrap gap-2 items-end',
} as const;

export const dataTableDensity = {
    comfortable: {
        wrapper: 'rounded-2xl',
        toolbar: 'p-4 border-b border-gray-100 space-y-3',
        headerCell:
            'text-left p-3 text-[10px] font-black uppercase tracking-widest text-gray-400 select-none group bg-gray-50/80 border-b border-gray-200',
        bodyCell: 'p-3',
        toolbarBtn:
            'flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all border',
        toolbarBtnIdle: 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50',
        searchInput:
            'w-full bg-gray-50 border border-gray-200 rounded-xl py-2 pl-10 pr-4 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 transition-all font-medium',
        emptyState: 'p-12',
        emptyIcon: 'w-16 h-16',
        pagination: 'px-4 py-3',
        filterLabel: 'text-[10px] font-black uppercase tracking-widest text-gray-400',
        defaultPageSize: 20,
    },
    compact: {
        wrapper: 'rounded-lg',
        toolbar: 'p-2 border-b border-gray-100 space-y-2',
        headerCell:
            'text-left px-2 py-1.5 text-xs font-medium text-gray-500 select-none group bg-gray-50/80 border-b border-gray-200',
        bodyCell: 'px-2 py-1.5 text-[13px]',
        toolbarBtn:
            'flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all border',
        toolbarBtnIdle: 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50',
        searchInput:
            'w-full bg-gray-50 border border-gray-200 rounded-lg py-1.5 pl-8 pr-3 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 transition-all',
        emptyState: 'p-6',
        emptyIcon: 'w-10 h-10',
        pagination: 'px-3 py-2',
        filterLabel: 'text-xs font-medium text-gray-500',
        defaultPageSize: 25,
    },
} as const;