'use client';

export type RankedItem = {
    id: string;
    name: string;
    meta: string;
    amount: string;
    avatarInitials?: string;
};

const AVATAR_COLORS = ['#2563eb', '#059669', '#f59e0b', '#db2777', '#06b6d4'];

export function RankedListPanel({
    title,
    items,
    emptyLabel,
}: {
    title: string;
    items: RankedItem[];
    emptyLabel: string;
}) {
    return (
        <div className="rounded-xl border border-gray-100 bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <h3 className="mb-2 text-xs font-bold text-gray-900">{title}</h3>
            {items.length === 0 ? (
                <p className="py-4 text-center text-[11px] text-gray-400">{emptyLabel}</p>
            ) : (
                <ul>
                    {items.map((item, i) => (
                        <li key={item.id} className="flex items-center gap-2 border-b border-gray-50 py-1.5 text-[11px] last:border-0">
                            <span className="w-4 shrink-0 text-center font-extrabold text-gray-400">{i + 1}</span>
                            {item.avatarInitials ? (
                                <span
                                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold text-white"
                                    style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}
                                >
                                    {item.avatarInitials}
                                </span>
                            ) : (
                                <span className="h-6 w-6 shrink-0 rounded-md bg-gray-100" />
                            )}
                            <span className="min-w-0">
                                <span className="block truncate font-semibold text-gray-900">{item.name}</span>
                                <span className="block text-[9px] text-gray-400">{item.meta}</span>
                            </span>
                            <span className="ml-auto font-extrabold text-gray-900">{item.amount}</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
