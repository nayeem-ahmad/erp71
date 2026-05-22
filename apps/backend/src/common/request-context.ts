import { AsyncLocalStorage } from 'async_hooks';

export const requestContext = new AsyncLocalStorage<{ requestId: string; tenantId?: string }>();

export const getRequestId = () => requestContext.getStore()?.requestId ?? 'no-context';
