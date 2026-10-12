import '../../../core/format/format.dart';

// Shapes of GET /mobile/pulse and GET /cashier-sessions/overview, plus the
// per-session reads the till detail uses. Money arrives as numbers or
// Prisma decimal strings; both go through parseDecimal.

double _money(Object? value) => parseDecimal(value) ?? 0;

int _int(Object? value) => value is num ? value.toInt() : 0;

Map<String, dynamic> _map(Object? value) =>
    value is Map<String, dynamic> ? value : const {};

List<Map<String, dynamic>> _list(Object? value) => [
  for (final item in (value is List ? value : const []))
    if (item is Map<String, dynamic>) item,
];

/// One day's completed sales, net of that day's refunds.
class DaySales {
  const DaySales({
    required this.date,
    required this.net,
    required this.returns,
    required this.count,
    required this.returnsCount,
    this.avgTicket,
  });

  factory DaySales.fromJson(Map<String, dynamic> json) => DaySales(
    date: DateTime.tryParse(json['date'] as String? ?? '') ?? DateTime(1970),
    net: _money(json['net']),
    returns: _money(json['returns']),
    count: _int(json['count']),
    returnsCount: _int(json['returns_count']),
    avgTicket: parseDecimal(json['avg_ticket']),
  );

  /// The workspace's calendar day, as a date with no time of day.
  final DateTime date;
  final double net;
  final double returns;
  final int count;
  final int returnsCount;

  /// Null with no sales: no average, rather than an average of nothing.
  final double? avgTicket;
}

class TenderSlice {
  const TenderSlice({
    required this.key,
    required this.label,
    required this.amount,
  });

  factory TenderSlice.fromJson(Map<String, dynamic> json) => TenderSlice(
    key: json['key'] as String? ?? 'cash',
    label: json['label'] as String? ?? 'Other',
    amount: _money(json['amount']),
  );

  final String key;
  final String label;
  final double amount;
}

class TrendPoint {
  const TrendPoint({
    required this.date,
    required this.netSales,
    required this.orders,
  });

  factory TrendPoint.fromJson(Map<String, dynamic> json) => TrendPoint(
    date: DateTime.tryParse(json['date'] as String? ?? '') ?? DateTime(1970),
    netSales: _money(json['net_sales']),
    orders: _int(json['orders']),
  );

  final DateTime date;
  final double netSales;
  final int orders;
}

/// What is owed, to the shop or by it, across the whole book.
class Balance {
  const Balance({required this.outstanding, required this.parties});

  final double outstanding;

  /// Customers owing, or suppliers owed.
  final int parties;
}

class Pulse {
  const Pulse({
    required this.today,
    required this.yesterday,
    required this.lastWeek,
    required this.vsYesterdayPct,
    required this.vsLastWeekPct,
    required this.grossProfit,
    required this.marginPct,
    required this.uncostedItems,
    required this.tenders,
    required this.trend,
    required this.receivables,
    required this.payables,
    required this.generatedAt,
  });

  factory Pulse.fromJson(Map<String, dynamic> json) {
    final change = _map(json['change']);
    final margin = _map(json['margin']);
    final receivables = _map(json['receivables']);
    final payables = json['payables'];
    return Pulse(
      today: DaySales.fromJson(_map(json['today'])),
      yesterday: DaySales.fromJson(_map(json['yesterday'])),
      lastWeek: DaySales.fromJson(_map(json['last_week'])),
      vsYesterdayPct: parseDecimal(change['vs_yesterday_pct']),
      vsLastWeekPct: parseDecimal(change['vs_last_week_pct']),
      grossProfit: parseDecimal(margin['gross_profit']),
      marginPct: parseDecimal(margin['margin_pct']),
      uncostedItems: _int(margin['uncosted_items']),
      tenders: [
        for (final t in _list(json['tenders'])) TenderSlice.fromJson(t),
      ],
      trend: [for (final p in _list(json['trend'])) TrendPoint.fromJson(p)],
      receivables: Balance(
        outstanding: _money(receivables['outstanding']),
        parties: _int(receivables['customers_owing']),
      ),
      payables: payables is Map<String, dynamic>
          ? Balance(
              outstanding: _money(payables['outstanding']),
              parties: _int(payables['suppliers_owing']),
            )
          : null,
      generatedAt: parseInstant(json['generated_at']),
    );
  }

  final DaySales today;
  final DaySales yesterday;

  /// The same weekday a week ago.
  final DaySales lastWeek;

  /// Null with nothing to compare against.
  final double? vsYesterdayPct;
  final double? vsLastWeekPct;

  /// Null when no line sold today carried a cost.
  final double? grossProfit;
  final double? marginPct;

  /// Lines sold today with no cost recorded, left out of the margin.
  final int uncostedItems;

  final List<TenderSlice> tenders;

  /// The last seven days, oldest first, ending today.
  final List<TrendPoint> trend;

  final Balance receivables;

  /// Null for a member who may not read purchasing.
  final Balance? payables;

  /// When the server built these figures (they are cached for a minute).
  final DateTime? generatedAt;
}

/// One cashier's shift at one till.
class TillSession {
  const TillSession({
    required this.id,
    required this.isOpen,
    required this.branchName,
    required this.cashierName,
    required this.openedAt,
    required this.openingCash,
    required this.salesCount,
    required this.salesTotal,
    this.counterName,
    this.closedAt,
    this.cashTakings,
    this.expectedCash,
    this.closingCash,
    this.variance,
  });

  factory TillSession.fromJson(Map<String, dynamic> json) {
    final counter = json['counter'];
    return TillSession(
      id: json['id'] as String,
      isOpen: json['status'] == 'OPEN',
      branchName: _map(json['store'])['name'] as String? ?? 'Branch',
      cashierName: _map(json['cashier'])['name'] as String? ?? 'Cashier',
      counterName: counter is Map<String, dynamic>
          ? counter['name'] as String?
          : null,
      openedAt: parseInstant(json['opened_at']),
      closedAt: parseInstant(json['closed_at']),
      openingCash: _money(json['opening_cash']),
      salesCount: _int(json['sales_count']),
      salesTotal: _money(json['sales_total']),
      cashTakings: parseDecimal(json['cash_takings']),
      expectedCash: parseDecimal(json['expected_cash']),
      closingCash: parseDecimal(json['closing_cash']),
      variance: parseDecimal(json['variance']),
    );
  }

  final String id;
  final bool isOpen;
  final String branchName;
  final String cashierName;
  final String? counterName;
  final DateTime? openedAt;
  final DateTime? closedAt;
  final double openingCash;
  final int salesCount;
  final double salesTotal;
  final double? cashTakings;

  /// What the drawer should hold. Null on a shift closed before
  /// reconciliation existed.
  final double? expectedCash;

  /// What was counted at close.
  final double? closingCash;

  /// Counted less expected: negative is short. Null while open, and on
  /// shifts that were never reconciled.
  final double? variance;
}

class CashierOverview {
  const CashierOverview({
    required this.open,
    required this.closedToday,
    required this.expectedCash,
    required this.short,
    required this.over,
  });

  factory CashierOverview.fromJson(Map<String, dynamic> json) {
    final totals = _map(json['totals']);
    return CashierOverview(
      open: [for (final s in _list(json['open'])) TillSession.fromJson(s)],
      closedToday: [
        for (final s in _list(json['closed_today'])) TillSession.fromJson(s),
      ],
      expectedCash: _money(totals['expected_cash']),
      short: _money(totals['short']),
      over: _money(totals['over']),
    );
  }

  final List<TillSession> open;
  final List<TillSession> closedToday;

  /// Cash the open drawers should be holding between them.
  final double expectedCash;

  /// Sum of today's shortfalls (zero or negative).
  final double short;

  /// Sum of today's overages (zero or positive).
  final double over;

  TillSession? find(String id) {
    for (final session in [...open, ...closedToday]) {
      if (session.id == id) return session;
    }
    return null;
  }
}

/// GET /cashier-sessions/:id/summary — camelCase, unlike the rest.
class TillSummary {
  const TillSummary({
    required this.salesCount,
    required this.salesTotal,
    required this.cashTakings,
    required this.refunds,
    required this.openingCash,
    required this.cashIn,
    required this.cashOut,
    required this.expectedCash,
    required this.paymentBreakdown,
    this.closingCash,
    this.variance,
  });

  factory TillSummary.fromJson(Map<String, dynamic> json) => TillSummary(
    salesCount: _int(json['salesCount']),
    salesTotal: _money(json['salesTotal']),
    cashTakings: _money(json['cashTakings']),
    refunds: _money(json['refunds']),
    openingCash: _money(json['openingCash']),
    cashIn: _money(json['cashIn']),
    cashOut: _money(json['cashOut']),
    expectedCash: _money(json['expectedCash']),
    closingCash: parseDecimal(json['closingCash']),
    variance: parseDecimal(json['variance']),
    paymentBreakdown: [
      for (final row in _list(json['paymentBreakdown']))
        (
          method: row['method'] as String? ?? 'Other',
          amount: _money(row['amount']),
        ),
    ],
  );

  final int salesCount;
  final double salesTotal;
  final double cashTakings;
  final double refunds;
  final double openingCash;
  final double cashIn;
  final double cashOut;
  final double expectedCash;
  final double? closingCash;
  final double? variance;
  final List<({String method, double amount})> paymentBreakdown;
}

/// Money put into or taken out of a drawer by hand.
class CashMovement {
  const CashMovement({
    required this.id,
    required this.amount,
    required this.type,
    this.description,
    this.createdAt,
  });

  factory CashMovement.fromJson(Map<String, dynamic> json) => CashMovement(
    id: json['id'] as String,
    amount: _money(json['amount']),
    type: json['type'] as String? ?? 'OTHER',
    description: json['description'] as String?,
    createdAt: parseInstant(json['created_at']),
  );

  final String id;

  /// Positive in, negative out.
  final double amount;

  /// `DROP`, `LOAN`, `PAYOUT`, `OTHER`.
  final String type;
  final String? description;
  final DateTime? createdAt;

  /// The web's names for the types. Which way the money went is the sign of
  /// [amount], never the type: the web form and the backend describe DROP
  /// and LOAN differently, and the stored amount is what was posted.
  String get typeLabel => switch (type) {
    'DROP' => 'Cash drop',
    'LOAN' => 'Cash loan',
    'PAYOUT' => 'Payout',
    _ => amount >= 0 ? 'Cash in' : 'Cash out',
  };
}
