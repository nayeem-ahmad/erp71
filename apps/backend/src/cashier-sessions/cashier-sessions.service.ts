import { Injectable, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { OpenSessionDto } from './dto/open-session.dto';
import { CloseSessionDto } from './dto/close-session.dto';
import { CountersService } from '../counters/counters.service';

@Injectable()
export class CashierSessionsService {
  constructor(
    private db: DatabaseService,
    private countersService: CountersService,
  ) {}

  async openSession(tenantId: string, userId: string, dto: OpenSessionDto) {
    const existingOpenSession = await this.db.cashierSession.findFirst({
      where: {
        tenant_id: tenantId,
        user_id: userId,
        status: 'OPEN',
      },
    });

    if (existingOpenSession) {
      throw new BadRequestException('User already has an open cashier session');
    }

    if (dto.counterId) {
      await this.countersService.validateCounterBelongsToStore(tenantId, dto.counterId, dto.storeId);

      const counterInUse = await this.db.cashierSession.findFirst({
        where: { counter_id: dto.counterId, status: 'OPEN' },
      });

      if (counterInUse) {
        throw new BadRequestException('This counter already has an open session');
      }
    }

    return this.db.cashierSession.create({
      data: {
        tenant_id: tenantId,
        store_id: dto.storeId,
        counter_id: dto.counterId ?? null,
        user_id: userId,
        opening_cash: dto.openingCash,
        status: 'OPEN',
      },
      include: { counter: true },
    });
  }

  async closeSession(tenantId: string, sessionId: string, dto: CloseSessionDto) {
    const session = await this.db.cashierSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new BadRequestException('Session not found');
    }

    if (session.tenant_id !== tenantId) {
      throw new BadRequestException('Session does not belong to this tenant');
    }

    if (session.status === 'CLOSED') {
      throw new BadRequestException('Session is already closed');
    }

    return this.db.cashierSession.update({
      where: { id: sessionId },
      data: {
        closed_at: new Date(),
        closing_cash: dto.closingCash,
        status: 'CLOSED',
      },
    });
  }

  async getOpenSessionByUser(tenantId: string, userId: string) {
    return this.db.cashierSession.findFirst({
      where: {
        tenant_id: tenantId,
        user_id: userId,
        status: 'OPEN',
      },
      include: { counter: true },
    });
  }

  async getSessionsByStore(tenantId: string, storeId: string) {
    return this.db.cashierSession.findMany({
      where: {
        tenant_id: tenantId,
        store_id: storeId,
      },
      orderBy: {
        opened_at: 'desc',
      },
    });
  }

  async getSessionById(tenantId: string, sessionId: string) {
    const session = await this.db.cashierSession.findUnique({
      where: { id: sessionId },
      include: { counter: true },
    });

    if (!session || session.tenant_id !== tenantId) {
      throw new BadRequestException('Session not found');
    }

    return session;
  }

  // Cash in/out tracking methods
  async addCashTransaction(tenantId: string, sessionId: string, amount: number, type: string, description?: string) {
    const session = await this.db.cashierSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new BadRequestException('Session not found');
    }

    if (session.tenant_id !== tenantId) {
      throw new BadRequestException('Session does not belong to this tenant');
    }

    if (session.status !== 'OPEN') {
      throw new BadRequestException('Cannot add transaction to closed session');
    }

    return this.db.cashTransaction.create({
      data: {
        tenant_id: tenantId,
        session_id: sessionId,
        amount: amount,
        type: type,
        description: description,
      },
    });
  }

  async getCashTransactions(tenantId: string, sessionId: string) {
    const session = await this.db.cashierSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new BadRequestException('Session not found');
    }

    if (session.tenant_id !== tenantId) {
      throw new BadRequestException('Session does not belong to this tenant');
    }

    return this.db.cashTransaction.findMany({
      where: {
        tenant_id: tenantId,
        session_id: sessionId,
      },
      orderBy: {
        created_at: 'asc',
      },
    });
  }
}