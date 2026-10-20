import { ForbiddenException } from '@nestjs/common';
import { PaymentMethodsController } from './payment-methods.controller';
import { TENDER_READ } from '../auth/permission-sets';

/**
 * GET /payment-methods: a `storeId` is checked against the caller's branches;
 * omitted, only owners / consolidated holders get every method.
 */
describe('PaymentMethodsController — list branch scope', () => {
  const owner = { tenantId: 't1', storeId: 's1', userId: 'u1', userRole: 'OWNER' } as any;
  const member = { ...owner, userRole: 'MANAGER' };
  const service = { findAll: jest.fn().mockResolvedValue([]) };
  const branchScope = {
    resolveStoreId: jest.fn(),
    memberStoreIds: jest.fn(),
    canSeeAllBranches: jest.fn(),
  };
  const controller = new PaymentMethodsController(service as any, branchScope as any);

  beforeEach(() => jest.clearAllMocks());

  it('storeId=S goes through the resolver with TENDER_READ and filters to that branch', async () => {
    branchScope.resolveStoreId.mockResolvedValue('s2');
    await controller.findAll(member, undefined, 's2');
    expect(branchScope.resolveStoreId).toHaveBeenCalledWith(member, 's2', { permissions: TENDER_READ });
    expect(service.findAll).toHaveBeenCalledWith('t1', { type: undefined, storeIds: ['s2'] });
  });

  it('keeps the type filter alongside the branch', async () => {
    branchScope.resolveStoreId.mockResolvedValue('s2');
    await controller.findAll(member, 'Cash' as any, 's2');
    expect(service.findAll).toHaveBeenCalledWith('t1', { type: 'Cash', storeIds: ['s2'] });
  });

  it('storeId=all lists every method for a caller the resolver allows', async () => {
    branchScope.resolveStoreId.mockResolvedValue(undefined);
    await controller.findAll(owner, undefined, 'all');
    expect(branchScope.resolveStoreId).toHaveBeenCalledWith(owner, 'all', { permissions: TENDER_READ });
    expect(service.findAll).toHaveBeenCalledWith('t1', { type: undefined, storeIds: undefined });
  });

  it('a member naming a foreign branch is refused by the scope service', async () => {
    branchScope.resolveStoreId.mockRejectedValue(new ForbiddenException());
    await expect(controller.findAll(member, undefined, 'foreign')).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.findAll).not.toHaveBeenCalled();
  });

  it('omitted, an owner gets every method', async () => {
    branchScope.canSeeAllBranches.mockResolvedValue(true);
    await controller.findAll(owner);
    expect(service.findAll).toHaveBeenCalledWith('t1', { type: undefined, storeIds: undefined });
    expect(branchScope.memberStoreIds).not.toHaveBeenCalled();
  });

  it('omitted, a limited member gets methods available at their branches', async () => {
    branchScope.canSeeAllBranches.mockResolvedValue(false);
    branchScope.memberStoreIds.mockResolvedValue(['s1', 's3']);
    await controller.findAll(member);
    expect(service.findAll).toHaveBeenCalledWith('t1', { type: undefined, storeIds: ['s1', 's3'] });
  });

  it('a blank storeId counts as omitted', async () => {
    branchScope.canSeeAllBranches.mockResolvedValue(false);
    branchScope.memberStoreIds.mockResolvedValue(['s1']);
    await controller.findAll(member, undefined, '  ');
    expect(branchScope.resolveStoreId).not.toHaveBeenCalled();
    expect(service.findAll).toHaveBeenCalledWith('t1', { type: undefined, storeIds: ['s1'] });
  });
});

describe('PaymentMethodsController — layout branch scope', () => {
  const member = { tenantId: 't1', storeId: 's1', userId: 'u1', userRole: 'MANAGER' } as any;
  const layout = { customised: false, visible: [], available: [] };
  const service = {
    getLayout: jest.fn().mockResolvedValue(layout),
    saveLayout: jest.fn().mockResolvedValue(layout),
    resetLayout: jest.fn().mockResolvedValue(layout),
  };
  const branchScope = { resolveStoreId: jest.fn() };
  const controller = new PaymentMethodsController(service as any, branchScope as any);

  beforeEach(() => jest.clearAllMocks());

  it('a member cannot read a layout for a branch they have no access to', async () => {
    branchScope.resolveStoreId.mockRejectedValue(new ForbiddenException());
    await expect(controller.getLayout(member, { storeId: 'foreign', context: 'sale' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(branchScope.resolveStoreId).toHaveBeenCalledWith(member, 'foreign', {
      permissions: TENDER_READ,
      allowAll: false,
    });
    expect(service.getLayout).not.toHaveBeenCalled();
  });

  it('save and reset are scoped the same way and pass the resolved branch', async () => {
    branchScope.resolveStoreId.mockResolvedValue('s2');
    await controller.saveLayout(member, { storeId: 's2', context: 'purchase' }, { order: ['a'], hidden: [] });
    await controller.resetLayout(member, { storeId: 's2', context: 'purchase' });
    expect(service.saveLayout).toHaveBeenCalledWith(member, 's2', 'purchase', { order: ['a'], hidden: [] });
    expect(service.resetLayout).toHaveBeenCalledWith(member, 's2', 'purchase');
    expect(branchScope.resolveStoreId).toHaveBeenCalledTimes(2);
  });
});
