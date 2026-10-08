import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/format/format.dart';
import '../../core/providers.dart';

/// GET /alerts/preferences: what may reach this phone, and the shop's lines.
class AlertPreferences {
  const AlertPreferences({
    required this.types,
    required this.muted,
    required this.quietEnabled,
    required this.quietFrom,
    required this.quietTo,
    required this.largeSale,
    required this.largeRefund,
    required this.tillShortfall,
  });

  factory AlertPreferences.fromJson(Map<String, dynamic> json) {
    final quiet = json['quiet'] as Map<String, dynamic>? ?? const {};
    final thresholds = json['thresholds'] as Map<String, dynamic>? ?? const {};
    return AlertPreferences(
      types: [
        for (final row in (json['types'] as List<dynamic>? ?? const []))
          if (row is Map<String, dynamic>)
            (
              type: row['type'] as String,
              label: row['label'] as String? ?? row['type'] as String,
              description: row['description'] as String? ?? '',
            ),
      ],
      muted: {
        for (final t in (json['muted_types'] as List<dynamic>? ?? const []))
          if (t is String) t,
      },
      quietEnabled: quiet['enabled'] != false,
      quietFrom: quiet['from'] as String? ?? '22:00',
      quietTo: quiet['to'] as String? ?? '08:00',
      largeSale: parseDecimal(thresholds['large_sale_amount']) ?? 50000,
      largeRefund: parseDecimal(thresholds['large_refund_amount']) ?? 10000,
      tillShortfall: parseDecimal(thresholds['till_shortfall_amount']) ?? 500,
    );
  }

  final List<({String type, String label, String description})> types;
  final Set<String> muted;
  final bool quietEnabled;

  /// `HH:mm`, workspace time.
  final String quietFrom;
  final String quietTo;
  final double largeSale;
  final double largeRefund;
  final double tillShortfall;
}

class AlertSettingsRepository {
  AlertSettingsRepository(this._api);

  final ApiClient _api;

  Future<AlertPreferences> load() async => AlertPreferences.fromJson(
    await _api.get('/alerts/preferences') as Map<String, dynamic>,
  );

  Future<AlertPreferences> save(Map<String, Object?> changes) async =>
      AlertPreferences.fromJson(
        await _api.put('/alerts/preferences', body: changes)
            as Map<String, dynamic>,
      );

  Future<AlertPreferences> saveThresholds(Map<String, Object?> values) async =>
      AlertPreferences.fromJson(
        await _api.put('/alerts/thresholds', body: values)
            as Map<String, dynamic>,
      );
}

final alertSettingsRepositoryProvider = Provider<AlertSettingsRepository>(
  (ref) => AlertSettingsRepository(ref.watch(apiClientProvider)),
);

final alertPreferencesProvider = FutureProvider.autoDispose<AlertPreferences>((
  ref,
) {
  ref.watch(activeWorkspaceProvider.select((w) => w?.id));
  return ref.watch(alertSettingsRepositoryProvider).load();
});
