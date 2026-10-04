import { SkeletonBar } from '@/components/ui/PageSkeleton';
import SkeletonStatus from '@/components/ui/SkeletonStatus';

/*
 * The till is the one sales page that is not a `PageShell` list: product grid
 * on the left, cart on the right. Drawn in that shape, from the same bars as
 * `PageSkeleton`, so a cashier opening it sees the counter rather than a table
 * that then turns into one. Below `md` the cart is a bottom sheet that starts
 * closed, so its placeholder is hidden there too.
 */
export default function PosLoading() {
    return (
        <div className="flex h-full flex-col overflow-hidden bg-canvas font-sans md:flex-row">
            <div aria-hidden className="flex min-w-0 flex-1 flex-col space-y-4 overflow-hidden p-4 md:space-y-6 md:p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-1.5">
                        <SkeletonBar onCanvas className="h-7 w-40" />
                        <SkeletonBar onCanvas className="h-3 w-56 max-w-full" />
                    </div>
                    <div className="flex items-center gap-2">
                        <SkeletonBar onCanvas className="h-10 min-w-0 flex-1 rounded-lg sm:w-64 sm:flex-none" />
                        <SkeletonBar onCanvas className="h-10 w-20 shrink-0 rounded-lg" />
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                    {Array.from({ length: 10 }, (_, index) => (
                        <div key={index} className="space-y-3 rounded-lg bg-white p-4 shadow-sm">
                            <SkeletonBar className="aspect-square w-full rounded-lg" />
                            <SkeletonBar className="h-3 w-3/4" />
                            <SkeletonBar className="h-4 w-1/2" />
                        </div>
                    ))}
                </div>
            </div>
            <div aria-hidden className="hidden flex-col gap-3 border-s border-gray-100 bg-white p-4 md:flex md:w-[400px]">
                <SkeletonBar className="h-10 w-full rounded-lg" />
                <SkeletonBar className="h-9 w-full rounded-lg" />
                <div className="flex-1 space-y-3 pt-2">
                    {['w-3/4', 'w-2/3', 'w-1/2'].map((width, index) => (
                        <div key={index} className="flex items-center justify-between gap-4">
                            <SkeletonBar className={`h-3 ${width}`} />
                            <SkeletonBar className="h-3 w-16 shrink-0" />
                        </div>
                    ))}
                </div>
                <SkeletonBar className="h-6 w-full" />
                <SkeletonBar className="h-11 w-full rounded-lg" />
            </div>
            <SkeletonStatus />
        </div>
    );
}
