import '../../../core/api/api_client.dart';
import 'models.dart';

/// The business endpoints the home and cashier tabs read. [storeId] is a
/// branch id, `all`, or null for the server's default (every branch for
/// those who may see them all, the request's branch for everyone else).
class BusinessRepository {
  BusinessRepository(this._api);

  final ApiClient _api;

  Future<Pulse> pulse({String? storeId}) async => Pulse.fromJson(
    await _api.get('/mobile/pulse', query: {'storeId': storeId})
        as Map<String, dynamic>,
  );

  Future<CashierOverview> cashierOverview({String? storeId}) async =>
      CashierOverview.fromJson(
        await _api.get(
              '/cashier-sessions/overview',
              query: {'storeId': storeId},
            )
            as Map<String, dynamic>,
      );

  Future<TillSummary> tillSummary(String sessionId) async =>
      TillSummary.fromJson(
        await _api.get('/cashier-sessions/$sessionId/summary')
            as Map<String, dynamic>,
      );

  Future<List<CashMovement>> cashMovements(String sessionId) async {
    final rows =
        await _api.get('/cashier-sessions/$sessionId/cash-transactions')
            as List<dynamic>? ??
        const [];
    return [
      for (final row in rows)
        if (row is Map<String, dynamic>) CashMovement.fromJson(row),
    ];
  }
}
