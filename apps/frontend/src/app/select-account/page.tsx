'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ShieldCheck, Store, ChevronRight, Loader2, LogOut } from 'lucide-react';
import { api } from '@/lib/api';
import {
    applyPlatformAdminContext,
    applyTenantContext,
    getLoginContexts,
    clearAuthSession,
} from '@/lib/auth-session';

function SelectAccountContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [me, setMe] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const shopRedirect = (() => {
        const redirect = searchParams.get('redirect');
        return redirect && redirect.startsWith('/') ? redirect : '/dashboard';
    })();

    useEffect(() => {
        api.getMe()
            .then((data: any) => {
                const { isPlatformAdmin, tenants, count } = getLoginContexts(data);
                // Nothing ambiguous to choose — resolve automatically.
                if (count <= 1) {
                    if (tenants.length === 1) {
                        applyTenantContext(tenants[0]);
                        router.replace(shopRedirect);
                    } else if (isPlatformAdmin) {
                        applyPlatformAdminContext();
                        router.replace('/dashboard/admin');
                    } else {
                        router.replace('/dashboard');
                    }
                    return;
                }
                setMe(data);
                setIsLoading(false);
            })
            .catch((err: any) => {
                setError(err?.message || 'Could not load your account. Please sign in again.');
                setIsLoading(false);
            });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const chooseAdmin = () => {
        applyPlatformAdminContext();
        router.replace('/dashboard/admin');
    };

    const chooseTenant = (tenant: any) => {
        applyTenantContext(tenant);
        router.replace(shopRedirect);
    };

    const signOut = () => {
        clearAuthSession();
        router.replace('/login');
    };

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[#f9fafb]">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
        );
    }

    const { isPlatformAdmin, tenants } = getLoginContexts(me);

    return (
        <div className="min-h-screen flex items-center justify-center bg-[#f9fafb] p-4 font-sans text-[#111827]">
            <div className="w-full max-w-md">
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 md:p-10">
                    <div className="flex flex-col items-center mb-8 text-center">
                        <h1 className="text-2xl font-bold tracking-tight">Choose a workspace</h1>
                        <p className="text-gray-500 mt-2 text-sm">
                            {me?.name ? `Signed in as ${me.name}. ` : ''}
                            Select where you&apos;d like to continue.
                        </p>
                    </div>

                    {error && (
                        <div className="mb-6 p-3 bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl text-center">
                            {error}
                        </div>
                    )}

                    <div className="space-y-3">
                        {isPlatformAdmin && (
                            <button
                                type="button"
                                onClick={chooseAdmin}
                                className="w-full flex items-center gap-3 p-4 rounded-xl border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/50 transition-all duration-150 text-left group"
                            >
                                <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center flex-shrink-0">
                                    <ShieldCheck className="w-5 h-5" />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="font-semibold text-sm tracking-tight">Platform Admin Console</p>
                                    <p className="text-xs text-gray-500">Manage tenants, users, and the platform</p>
                                </div>
                                <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-indigo-500 group-hover:translate-x-0.5 transition-all flex-shrink-0" />
                            </button>
                        )}

                        {tenants.map((tenant: any) => (
                            <button
                                key={tenant.id}
                                type="button"
                                onClick={() => chooseTenant(tenant)}
                                className="w-full flex items-center gap-3 p-4 rounded-xl border border-gray-200 hover:border-blue-300 hover:bg-blue-50/50 transition-all duration-150 text-left group"
                            >
                                <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center flex-shrink-0">
                                    <Store className="w-5 h-5" />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="font-semibold text-sm tracking-tight truncate">{tenant.name}</p>
                                    <p className="text-xs text-gray-500">
                                        {tenant.role ? tenant.role.charAt(0) + tenant.role.slice(1).toLowerCase() : 'Member'}
                                        {tenant.subscription?.plan?.code ? ` · ${tenant.subscription.plan.code}` : ''}
                                    </p>
                                </div>
                                <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-blue-500 group-hover:translate-x-0.5 transition-all flex-shrink-0" />
                            </button>
                        ))}
                    </div>

                    <button
                        type="button"
                        onClick={signOut}
                        className="mt-6 w-full flex items-center justify-center gap-2 text-sm text-gray-500 hover:text-red-600 transition-colors"
                    >
                        <LogOut className="w-4 h-4" />
                        <span>Sign out</span>
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function SelectAccountPage() {
    return (
        <Suspense
            fallback={
                <div className="min-h-screen flex items-center justify-center bg-[#f9fafb]">
                    <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                </div>
            }
        >
            <SelectAccountContent />
        </Suspense>
    );
}
