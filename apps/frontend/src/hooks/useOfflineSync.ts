'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getPendingSales,
  removePendingSale,
} from '@/lib/pos-db';

export interface OfflineSyncResult {
  isOnline: boolean;
  pendingCount: number;
  isSyncing: boolean;
  syncNow: () => Promise<void>;
  refreshPendingCount: () => Promise<void>;
}

export function useOfflineSync(): OfflineSyncResult {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const swRegistrationRef = useRef<ServiceWorkerRegistration | null>(null);

  // Refresh pending count from IndexedDB
  const refreshPendingCount = useCallback(async () => {
    try {
      const sales = await getPendingSales();
      setPendingCount(sales.length);
    } catch {
      // IndexedDB may not be available in all environments
    }
  }, []);

  // Manual sync: read pending sales from IndexedDB and POST them
  const syncNow = useCallback(async () => {
    if (isSyncing) return;
    setIsSyncing(true);

    try {
      const pendingSales = await getPendingSales();
      if (pendingSales.length === 0) {
        setIsSyncing(false);
        return;
      }

      for (const sale of pendingSales) {
        const { authToken, tenantId, id, ...salePayload } = sale;

        try {
          const response = await fetch('/api/v1/sales', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${authToken}`,
              'x-tenant-id': tenantId,
            },
            body: JSON.stringify(salePayload),
          });

          if (response.ok) {
            await removePendingSale(id);
          }
        } catch {
          // Network error for this sale — leave in queue, try next
        }
      }

      await refreshPendingCount();
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing, refreshPendingCount]);

  // Register Background Sync or fall back to manual sync when coming online
  const handleOnline = useCallback(async () => {
    setIsOnline(true);

    try {
      const reg = swRegistrationRef.current;
      if (reg && 'sync' in reg) {
        // @ts-expect-error: Background Sync API not in all TS libs
        await reg.sync.register('pos-sync');
      } else {
        // Fallback: sync manually if Background Sync isn't supported
        await syncNow();
      }
    } catch {
      // If background sync registration fails, fall back to manual
      await syncNow();
    }
  }, [syncNow]);

  const handleOffline = useCallback(() => {
    setIsOnline(false);
  }, []);

  useEffect(() => {
    // Register service worker
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          swRegistrationRef.current = reg;
        })
        .catch((err) => {
          console.error('[useOfflineSync] SW registration failed:', err);
        });

      // Listen for sync-complete messages from the SW
      const handleSwMessage = (event: MessageEvent) => {
        if (event.data?.type === 'sync-complete') {
          refreshPendingCount();
        }
      };
      navigator.serviceWorker.addEventListener('message', handleSwMessage);

      return () => {
        navigator.serviceWorker.removeEventListener('message', handleSwMessage);
      };
    }
  }, [refreshPendingCount]);

  useEffect(() => {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial count
    refreshPendingCount();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [handleOnline, handleOffline, refreshPendingCount]);

  return { isOnline, pendingCount, isSyncing, syncNow, refreshPendingCount };
}
