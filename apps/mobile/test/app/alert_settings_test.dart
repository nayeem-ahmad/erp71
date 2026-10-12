import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/app_harness.dart';

Map<String, Object?> preferencesJson({
  List<String> muted = const [],
  bool quiet = true,
}) => {
  'types': [
    {
      'type': 'TILL_SHORTFALL',
      'label': 'Short tills',
      'description': 'A till closed short.',
    },
    {
      'type': 'LOW_STOCK',
      'label': 'Low stock',
      'description': 'Products at their reorder level.',
    },
  ],
  'muted_types': muted,
  'quiet': {'enabled': quiet, 'from': '22:00', 'to': '08:00'},
  'thresholds': {
    'large_sale_amount': 50000,
    'large_refund_amount': 10000,
    'till_shortfall_amount': 500,
  },
};

Finder tab(String label) =>
    find.descendant(of: find.byType(NavigationBar), matching: find.text(label));

Future<void> openSettings(WidgetTester tester) async {
  await tester.tap(tab('Alerts'));
  await tester.pumpAndSettle();
  await tester.tap(find.byTooltip('Notification settings'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('turning a kind of alert off keeps it off this phone only', (
    tester,
  ) async {
    final backend = crmBackend()
      ..on('GET', '/alerts/preferences', (_) => preferencesJson())
      ..on('PUT', '/alerts/preferences', (request) {
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        return preferencesJson(
          muted: [for (final t in body['muted_types'] as List) t as String],
        );
      });
    await pumpApp(tester, backend: backend);
    await signInWithGoogle(tester);
    await openSettings(tester);

    expect(find.text('Short tills'), findsOneWidget);
    await tester.tap(find.widgetWithText(SwitchListTile, 'Low stock'));
    await tester.pumpAndSettle();

    expect(backend.lastBody('PUT', '/alerts/preferences'), {
      'muted_types': ['LOW_STOCK'],
    });
    final lowStock = tester.widget<SwitchListTile>(
      find.widgetWithText(SwitchListTile, 'Low stock'),
    );
    expect(lowStock.value, isFalse);
  });

  testWidgets('quiet hours can be switched off', (tester) async {
    final backend = crmBackend()
      ..on('GET', '/alerts/preferences', (_) => preferencesJson())
      ..on('PUT', '/alerts/preferences', (_) => preferencesJson(quiet: false));
    await pumpApp(tester, backend: backend);
    await signInWithGoogle(tester);
    await openSettings(tester);

    expect(find.text('22:00'), findsOneWidget);
    await tester.tap(
      find.widgetWithText(SwitchListTile, 'Hold alerts at night'),
    );
    await tester.pumpAndSettle();

    expect(backend.lastBody('PUT', '/alerts/preferences'), {
      'quiet_enabled': false,
    });
    expect(find.text('22:00'), findsNothing);
  });

  testWidgets('a member shown the shop’s alert amounts cannot change them', (
    tester,
  ) async {
    final backend = crmBackend()
      ..on('GET', '/alerts/preferences', (_) => preferencesJson());
    await pumpApp(tester, backend: backend);
    await signInWithGoogle(tester);
    await openSettings(tester);

    await tester.ensureVisible(find.text('When the shop raises an alert'));
    await tester.pumpAndSettle();
    expect(find.text('৳ 50,000.00 or more'), findsOneWidget);
    expect(find.text('Save amounts'), findsNothing);
  });

  testWidgets('an owner sets the amounts, with a line said on its field', (
    tester,
  ) async {
    final backend = ownerBackend()
      ..on('GET', '/alerts/preferences', (_) => preferencesJson())
      ..on('PUT', '/alerts/thresholds', (_) => preferencesJson());
    await pumpApp(tester, backend: backend);
    await signInWithGoogle(tester);
    await openSettings(tester);

    await tester.ensureVisible(find.text('Save amounts'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.widgetWithText(TextField, 'A till short by at least'),
      '',
    );
    await tester.tap(find.text('Save amounts'));
    await tester.pumpAndSettle();
    expect(find.text('Enter an amount of at least ৳ 1'), findsOneWidget);
    expect(backend.sent('PUT', '/alerts/thresholds'), isEmpty);

    await tester.enterText(
      find.widgetWithText(TextField, 'A till short by at least'),
      '1000',
    );
    await tester.tap(find.text('Save amounts'));
    await tester.pumpAndSettle();
    expect(backend.lastBody('PUT', '/alerts/thresholds'), {
      'large_sale_amount': 50000,
      'large_refund_amount': 10000,
      'till_shortfall_amount': 1000,
    });
  });
}
