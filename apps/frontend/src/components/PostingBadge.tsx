import { BookOpen, CheckCircle, Clock, SkipForward, XCircle } from 'lucide-react';

const POSTING_STATUS_CONFIG: Record<string, {
    label: string;
    cls: string;
    icon: React.ReactNode;
}> = {
    posted: {
        label: 'Posted',
        cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        icon: <CheckCircle className="w-3 h-3" />,
    },
    pending: {
        label: 'Pending',
        cls: 'bg-amber-50 text-amber-700 border-amber-200',
        icon: <Clock className="w-3 h-3" />,
    },
    failed: {
        label: 'Failed',
        cls: 'bg-red-50 text-red-700 border-red-200',
        icon: <XCircle className="w-3 h-3" />,
    },
    skipped: {
        label: 'Skipped',
        cls: 'bg-gray-50 text-gray-500 border-gray-200',
        icon: <SkipForward className="w-3 h-3" />,
    },
};

interface PostingBadgeProps {
    status: string | null | undefined;
    voucherNumber?: string | null;
}

export function PostingBadge({ status, voucherNumber }: PostingBadgeProps) {
    if (!status) return <span className="text-gray-300 text-xs">—</span>;

    const config = POSTING_STATUS_CONFIG[status];
    if (!config) return <span className="text-xs text-gray-500">{status}</span>;

    return (
        <div className="flex flex-col gap-0.5">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border ${config.cls}`}>
                {config.icon}
                {config.label}
            </span>
            {voucherNumber && (
                <span className="font-mono text-[10px] text-gray-400 flex items-center gap-0.5">
                    <BookOpen className="w-2.5 h-2.5" />
                    {voucherNumber}
                </span>
            )}
        </div>
    );
}
