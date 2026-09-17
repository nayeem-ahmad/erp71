import { Injectable, BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import { OpenSessionDto } from './dto/open-session.dto';
import { CloseSessionDto } from './dto/close-session.dto';
import { CountersService } from '../counters/counters.service';
import { autoPostFromRules } from '../accounting/posting.utils';
import { classifyPaymentMode } from '../sales/classify-payment-mode';

// CashTransaction.type values that move cash out of the till and must post.
// DROP (drawer→safe) and OTHER stay unposted — both sides are Cash in Hand.
const POSTABLE_CASH_TYPES = new Set(['PAYOUT', 'LOAN']);

/**
 * Whether a tender put notes in the drawer.
 *
 * Reuses the classifier the posting rules key off rather than matching names
 * here, so the drawer and the general ledger cannot disagree about what "cash"
 * means for a tenant that renamed its payment methods. Everything else — card,
 * bKash, Nagad, bank, customer credit — settles somewhere a cashier cannot
 * count at close, so it belongs in the takings breakdown and never in expected
 * cash. An unrecognised custom method falls back to cash, which is the same
 * assumption the ledger makes about it.
 */
const isCashTender = (method: string) => classifyPaymentMode(method) === 'cash';

const money = (value: Prisma.Decimal | number | null | undefined) => Number(value ?? 0);

/** Two decimal places, the way a drawer is counted. */
const round2 = (value: number) => Math.round(value * 100) / 100;

@Injectable()
export class CashierSessionsService {
  constructor(
    private db: DatabaseService,
    private countersService: CountersService,
  ) {}

  async openSession(tenantId: string, userId: string, dto: OpenSessionDto) {
    // The store arrives from the browser. Everything else on the row is
    // derived or validated, so without this a shift — and its cash — could be
    // filed against a branch the person does not work at, or a store id that
    // belongs to nobody.
    const store = await this.db.store.findFirst({
      where: { id: dto.storeId, tenant_id: tenantId },
      select: { id: true },
    });

    if (!store) {
      throw new BadRequestException('Store not found');
    }

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

    try {
      return await this.db.cashierSession.create({
        data: {
          tenant_id: tenantId,
          store_id: dto.storeId,
          counter_id: dto.counterId ?? null,
          user_id: userId,
          opening_cash: dto.openingCash,
          status: 'OPEN',
          // The two checks above are a read followed by a write, which two
          // cashiers tapping Open in the same second both pass. These carry
          // the same rule into a unique index — see the column comments on
          // CashierSession — so the loser of that race is rejected by the
          // database rather than quietly given a second session.
          open_counter_key: dto.counterId ?? null,
          open_user_key: userId,
        },
        include: { counter: true },
      });
    } catch (error) {
      // Duck-typed rather than `instanceof PrismaClientKnownRequestError`:
      // the client is generated to a custom output path, so the error class
      // the service would compare against is not always the one the query
      // engine threw. Same reasoning as stores.service.ts.
      const failure = error as { code?: string; meta?: { target?: string | string[] } };
      if (failure?.code === 'P2002') {
        const target = String(failure.meta?.target ?? '');
        throw new BadRequestException(
          target.includes('open_counter_key')
            ? 'This counter already has an open session'
            : 'User already has an open cashier session',
        );
      }
      throw error;
    }
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

    // Reconcile against what the till actually took, not just the cash the
    // cashier typed into the in/out box. Frozen onto the row here so a later
    // backdated sale cannot rewrite a count somebody signed off on.
    const summary = await this.getSessionSummary(tenantId, sessionId);
    const closingCash = money(dto.closingCash);

    return this.db.cashierSession.update({
      where: { id: sessionId },
      data: {
        closed_at: new Date(),
        closing_cash: closingCash,
        status: 'CLOSED',
        expected_cash: summary.expectedCash,
        variance: round2(closingCash - summary.expectedCash),
        // Releases the till and the cashier for the next shift. Both must go
        // back to null or the unique indexes would make a counter usable once
        // and never again.
        open_counter_key: null,
        open_user_key: null,
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
      include: {
        counter: { select: { id: true, name: true, counter_number: true } },
        user: { select: { id: true, name: true } },
      },
      orderBy: {
        opened_at: 'desc',
      },
    });
  }

  /**
   * Every till currently open in a store, with what each one is holding.
   *
   * This is the floor view a manager needs and had no way to reach: the only
   * other read is "my own open session", so an owner with three counters
   * running could not see who was on them or how much cash was in them.
   */
  async getOpenSessionsByStore(tenantId: string, storeId: string) {
    const sessions = await this.db.cashierSession.findMany({
      where: { tenant_id: tenantId, store_id: storeId, status: 'OPEN' },
      include: {
        counter: { select: { id: true, name: true, counter_number: true } },
        user: { select: { id: true, name: true } },
      },
      orderBy: { opened_at: 'asc' },
    });

    return Promise.all(
      sessions.map(async (session) => ({
        ...session,
        summary: await this.getSessionSummary(tenantId, session.id),
      })),
    );
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

  /**
   * What this shift took, and what the drawer should therefore hold.
   *
   * The close screen used to show `opening + cash in − cash out` as "expected
   * cash", which omits every cash sale — so a till that sold anything always
   * read short by exactly its takings, and the number was confident about it.
   * A sale now carries `session_id`, so the takings are a lookup rather than a
   * guess, and only the cash half of them reaches the drawer.
   */
  async getSessionSummary(tenantId: string, sessionId: string) {
    const session = await this.db.cashierSession.findUnique({
      where: { id: sessionId },
    });

    if (!session || session.tenant_id !== tenantId) {
      throw new BadRequestException('Session not found');
    }

    const [sales, salesReturns, cashTransactions] = await Promise.all([
      this.db.sale.findMany({
        where: {
          tenant_id: tenantId,
          session_id: sessionId,
          // A parked draft has taken no money and posts nothing; a cancelled
          // sale has given it back through its own reversal.
          status: { notIn: ['DRAFT', 'CANCELLED'] },
        },
        select: {
          id: true,
          total_amount: true,
          payments: { select: { payment_method: true, amount: true } },
        },
      }),
      // Refunds this shift paid out, whichever shift made the sale.
      this.db.salesReturn.findMany({
        where: {
          tenant_id: tenantId,
          session_id: sessionId,
          status: { not: 'CANCELLED' },
        },
        select: { total_refund: true },
      }),
      this.db.cashTransaction.findMany({
        where: { tenant_id: tenantId, session_id: sessionId },
        select: { amount: true, type: true },
      }),
    ]);

    const byMethod = new Map<string, number>();
    let cashTakings = 0;

    for (const sale of sales) {
      for (const payment of sale.payments) {
        const amount = money(payment.amount);
        byMethod.set(payment.payment_method, (byMethod.get(payment.payment_method) ?? 0) + amount);
        if (isCashTender(payment.payment_method)) {
          cashTakings += amount;
        }
      }
    }

    // A return settles in cash — `SalesReturnsService` has no other tender to
    // give it back through — so the whole refund comes out of this drawer.
    const refunds = salesReturns.reduce((sum, ret) => sum + money(ret.total_refund), 0);

    const cashIn = cashTransactions
      .filter((tx) => money(tx.amount) > 0)
      .reduce((sum, tx) => sum + money(tx.amount), 0);
    const cashOut = cashTransactions
      .filter((tx) => money(tx.amount) < 0)
      .reduce((sum, tx) => sum + Math.abs(money(tx.amount)), 0);

    const openingCash = money(session.opening_cash);
    const expectedCash = round2(openingCash + cashTakings - refunds + cashIn - cashOut);

    return {
      sessionId,
      salesCount: sales.length,
      salesTotal: round2(sales.reduce((sum, sale) => sum + money(sale.total_amount), 0)),
      cashTakings: round2(cashTakings),
      refunds: round2(refunds),
      openingCash: round2(openingCash),
      cashIn: round2(cashIn),
      cashOut: round2(cashOut),
      expectedCash,
      // Present only once the shift is closed — before that there is nothing
      // to compare the expectation against.
      closingCash: session.status === 'CLOSED' ? round2(money(session.closing_cash)) : null,
      variance: session.variance === null || session.variance === undefined
        ? null
        : round2(money(session.variance)),
      paymentBreakdown: [...byMethod.entries()]
        .map(([method, amount]) => ({ method, amount: round2(amount) }))
        .sort((a, b) => b.amount - a.amount),
    };
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

    return this.db.$transaction(async (tx) => {
      const cashTx = await tx.cashTransaction.create({
        data: {
          tenant_id: tenantId,
          session_id: sessionId,
          amount: amount,
          type: type,
          description: description,
        },
      });

      // PAYOUT/LOAN move cash out of the till and must reach the GL. amount is
      // signed (negative for cash out), so post its magnitude — autoPostFromRules
      // skips a non-positive amount, which also covers a mistakenly-zero entry.
      if (POSTABLE_CASH_TYPES.has(type)) {
        await autoPostFromRules({
          tx,
          tenantId,
          eventType: 'cash_transaction',
          conditionKey: 'reason_type',
          conditionValue: type,
          sourceModule: 'cashier-sessions',
          sourceType: 'cash_transaction',
          sourceId: cashTx.id,
          amount: Math.abs(Number(amount)),
          description: description ?? `Cashier ${type.toLowerCase()}`,
          storeId: session.store_id,
        });
      }

      return cashTx;
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
