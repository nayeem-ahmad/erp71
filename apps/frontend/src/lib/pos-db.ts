// IndexedDB utility for POS offline data
// DB: 'pos-offline', version 1
// Stores:
//   'pending-sales'  — keyPath='id', offline queued sales
//   'products-cache' — keyPath='id', cached product list

export interface PendingSale {
  id: string;           // uuid generated client-side
  storeId: string;
  totalAmount: number;
  amountPaid: number;
  items: { productId: string; quantity: number; priceAtSale: number }[];
  payments: { paymentMethod: string; amount: number }[];
  createdAt: string;    // ISO timestamp
  authToken: string;    // JWT to use when syncing
  tenantId: string;     // x-tenant-id header
}

export interface Product {
  id: string;
  [key: string]: unknown;
}

const DB_NAME = 'pos-offline';
const DB_VERSION = 1;
const STORE_PENDING = 'pending-sales';
const STORE_PRODUCTS = 'products-cache';

export function openPosDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_PENDING)) {
        db.createObjectStore(STORE_PENDING, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_PRODUCTS)) {
        db.createObjectStore(STORE_PRODUCTS, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function savePendingSale(sale: PendingSale): Promise<void> {
  const db = await openPosDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PENDING, 'readwrite');
    const store = tx.objectStore(STORE_PENDING);
    const req = store.put(sale);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export async function getPendingSales(): Promise<PendingSale[]> {
  const db = await openPosDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PENDING, 'readonly');
    const store = tx.objectStore(STORE_PENDING);
    const req = store.getAll();
    req.onsuccess = () => {
      resolve(req.result as PendingSale[]);
      db.close();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function removePendingSale(id: string): Promise<void> {
  const db = await openPosDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PENDING, 'readwrite');
    const store = tx.objectStore(STORE_PENDING);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export async function cacheProducts(products: Product[]): Promise<void> {
  const db = await openPosDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PRODUCTS, 'readwrite');
    const store = tx.objectStore(STORE_PRODUCTS);

    // Clear old cache and repopulate
    const clearReq = store.clear();
    clearReq.onsuccess = () => {
      for (const product of products) {
        store.put(product);
      }
    };
    clearReq.onerror = () => reject(clearReq.error);

    tx.oncomplete = () => {
      resolve();
      db.close();
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function getCachedProducts(): Promise<Product[]> {
  const db = await openPosDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PRODUCTS, 'readonly');
    const store = tx.objectStore(STORE_PRODUCTS);
    const req = store.getAll();
    req.onsuccess = () => {
      resolve(req.result as Product[]);
      db.close();
    };
    req.onerror = () => reject(req.error);
  });
}
