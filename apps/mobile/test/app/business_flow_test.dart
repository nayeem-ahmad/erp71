import 'dart:convert';

import 'package:erp71_mobile/core/auth/token_store.dart';
import 'package:erp71_mobile/core/security/app_lock.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/app_harness.dart';
import '../support/fake_backend.dart';
import '../support/fixtures.dart';

/// A phone that was signed in to [ownerWorkspaceJson] when it was last used.
InMemoryKeyValueStore signedInPhone({bool appLock = false}) =>
    InMemoryKeyValueStore()
      ..values.addAll({
        'erp71.session.v1': jsonEncode({
          'access_token': 'access-1',
          'refresh_token': 'refresh-1',
          'access_token_expires_at': DateTime.now()
              .add(const Duration(hours: 1))
              .toIso8601String(),
        }),
        'erp71.tenant.v1': 'tenant-1',
        'erp71.store.v1': 'store-1',
        if (appLock) AppLockController.storageKey: '1',
      });

/// A destination of the bottom bar, by its label.
Finder tab(String label) =>
    find.descendant(of: find.byType(NavigationBar), matching: find.text(label));

Future<void> openTab(WidgetTester tester, String label) async {
  await tester.tap(tab(label));
  await tester.pumpAndSettle();
}

/// Cashiers and the CRM live behind More for someone who runs the shop.
Future<void> openFromMore(WidgetTester tester, String label) async {
  await openTab(tester, 'More');
  await tester.tap(find.widgetWithText(ListTile, label));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('an owner lands on Home: today against yesterday, tenders, '
      'tills and balances', (tester) async {
    final backend = ownerBackend();
    await pumpApp(tester, backend: backend);
    await signInWithGoogle(tester);

    // The business bar, with Cashiers and the CRM behind More.
    for (final tabName in ['Home', 'Alerts', 'More']) {
      expect(tab(tabName), findsOneWidget);
    }
    expect(tab('Leads'), findsNothing);

    expect(find.text('Net sales today'), findsOneWidget);
    expect(find.text('৳ 6,000.00'), findsWidgets);
    expect(find.text('50.0%'), findsOneWidget);
    // The same weekday last week had no sales: no percentage, not +∞.
    expect(find.textContaining('Last Wednesday'), findsOneWidget);
    expect(find.text('৳ 1,500.00'), findsWidgets);
    expect(find.text('25.0%'), findsOneWidget);

    await tester.scrollUntilVisible(find.text('How it was paid'), 200);
    expect(find.text('bKash'), findsOneWidget);
    expect(find.text('৳ 2,500.00'), findsOneWidget);

    await tester.scrollUntilVisible(find.text('1 till open'), 200);
    expect(find.text('৳ 600.00 short at close today'), findsOneWidget);

    await tester.scrollUntilVisible(find.text('Balances'), 200);
    expect(find.text('Customers owe you (5)'), findsOneWidget);
    expect(find.text('You owe suppliers (3)'), findsOneWidget);

    // An owner of two branches starts on all of them.
    final pulse = backend.sent('GET', '/mobile/pulse').single;
    expect(pulse.url.queryParameters, {'storeId': 'all'});
    expect(pulse.headers['x-tenant-id'], 'tenant-1');
  });

  testWidgets('choosing a branch reloads Home and Cashiers for it', (
    tester,
  ) async {
    final backend = ownerBackend();
    await pumpApp(tester, backend: backend);
    await signInWithGoogle(tester);

    await tester.tap(find.text('All branches'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Mirpur Branch'));
    await tester.pumpAndSettle();

    expect(backend.sent('GET', '/mobile/pulse').last.url.queryParameters, {
      'storeId': 'store-2',
    });

    await openFromMore(tester, 'Cashiers');
    expect(
      backend
          .sent('GET', '/cashier-sessions/overview')
          .last
          .url
          .queryParameters,
      {'storeId': 'store-2'},
    );
    expect(find.text('Mirpur Branch'), findsOneWidget);
  });

  testWidgets('a member who may not read purchasing sees no payables line', (
    tester,
  ) async {
    final backend = ownerBackend()
      ..on('GET', '/mobile/pulse', (_) => pulseJson(payables: false));
    await pumpApp(tester, backend: backend);
    await signInWithGoogle(tester);

    await tester.scrollUntilVisible(find.text('Balances'), 200);
    expect(find.text('Customers owe you (5)'), findsOneWidget);
    expect(find.textContaining('You owe suppliers'), findsNothing);
  });

  testWidgets('a failed pulse says why and tries again', (tester) async {
    var calls = 0;
    final backend = ownerBackend()
      ..on('GET', '/mobile/pulse', (_) {
        calls++;
        return calls == 1
            ? apiError(403, 'VIEW_CONSOLIDATED_REPORTS permission required')
            : pulseJson();
      });
    await pumpApp(tester, backend: backend);
    await signInWithGoogle(tester);

    expect(
      find.text('VIEW_CONSOLIDATED_REPORTS permission required'),
      findsOneWidget,
    );
    await tester.tap(find.text('Try again'));
    await tester.pumpAndSettle();
    expect(find.text('Net sales today'), findsOneWidget);
  });

  testWidgets('Cashiers lists open and closed tills; a till shows its drawer', (
    tester,
  ) async {
    final backend = ownerBackend();
    await pumpApp(tester, backend: backend);
    await signInWithGoogle(tester);

    await openFromMore(tester, 'Cashiers');

    expect(find.text('Open tills'), findsOneWidget);
    expect(find.text('Rina Akter'), findsOneWidget);
    expect(find.text('Kamal Hossain'), findsOneWidget);
    // ৳600 short is past the ৳500 line.
    expect(find.text('Short ৳ 600.00'), findsOneWidget);

    await tester.tap(find.text('Rina Akter'));
    await tester.pumpAndSettle();

    expect(find.text('Cash drawer'), findsOneWidget);
    expect(find.text('Opening float'), findsOneWidget);
    expect(find.text('+ ৳ 500.00'), findsOneWidget);
    expect(find.text('Expected in drawer'), findsOneWidget);
    // Still open: nothing counted yet, so no difference to show.
    expect(find.text('Counted at close'), findsNothing);

    await tester.scrollUntilVisible(find.text('Payout'), 200);
    expect(find.textContaining('Tea for staff · '), findsOneWidget);
    expect(find.text('− ৳ 200.00'), findsWidgets);
    expect(find.text('Cash in'), findsWidgets);
  });

  testWidgets('More opens the CRM overview, with ways into its lists', (
    tester,
  ) async {
    await pumpApp(tester, backend: ownerBackend());
    await signInWithGoogle(tester);

    await openFromMore(tester, 'Overview');
    expect(find.text('Open leads'), findsOneWidget);

    await tester.tap(find.widgetWithText(OutlinedButton, 'Leads'));
    await tester.pumpAndSettle();
    expect(find.text('Rahim Uddin'), findsOneWidget);
    // Still under More.
    final bar = tester.widget<NavigationBar>(find.byType(NavigationBar));
    expect(bar.selectedIndex, 2);
  });

  group('app lock', () {
    testWidgets('turning it on asks for the phone lock first', (tester) async {
      final storage = InMemoryKeyValueStore();
      final authenticator = FakeDeviceAuthenticator();
      await pumpApp(
        tester,
        backend: ownerBackend(),
        storage: storage,
        authenticator: authenticator,
      );
      await signInWithGoogle(tester);

      await tester.tap(find.byTooltip('Account'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('App lock'));
      await tester.pumpAndSettle();

      expect(authenticator.reasons, ['Confirm it is you to turn on App lock']);
      expect(storage.values[AppLockController.storageKey], '1');
      expect(find.text('App lock is on'), findsOneWidget);
    });

    testWidgets('a phone with no screen lock cannot turn it on', (
      tester,
    ) async {
      final storage = InMemoryKeyValueStore();
      await pumpApp(
        tester,
        backend: ownerBackend(),
        storage: storage,
        authenticator: FakeDeviceAuthenticator(available: false),
      );
      await signInWithGoogle(tester);

      await tester.tap(find.byTooltip('Account'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('App lock'));
      await tester.pumpAndSettle();

      expect(storage.values, isNot(contains(AppLockController.storageKey)));
      expect(
        find.text('Set a screen lock on this phone first, then turn this on.'),
        findsOneWidget,
      );
    });

    testWidgets('opening the app asks again, and a failed check stays locked', (
      tester,
    ) async {
      final authenticator = FakeDeviceAuthenticator(
        result: DeviceAuthResult.failed,
      );
      await pumpApp(
        tester,
        backend: ownerBackend(),
        storage: signedInPhone(appLock: true),
        authenticator: authenticator,
      );

      // Asked straight away, once.
      expect(find.text('ERP71 is locked'), findsOneWidget);
      expect(authenticator.reasons, ['Unlock ERP71']);

      authenticator.result = DeviceAuthResult.passed;
      await tester.tap(find.text('Unlock'));
      await tester.pumpAndSettle();

      expect(find.text('ERP71 is locked'), findsNothing);
      expect(find.text('Net sales today'), findsOneWidget);
    });

    testWidgets('signing out from the lock leaves no lock for the next '
        'sign-in', (tester) async {
      await pumpApp(
        tester,
        backend: ownerBackend(),
        storage: signedInPhone(appLock: true),
        authenticator: FakeDeviceAuthenticator(result: DeviceAuthResult.failed),
      );

      await tester.tap(find.text('Sign out instead'));
      await tester.pumpAndSettle();
      expect(find.text('Continue with Google'), findsOneWidget);

      await signInWithGoogle(tester);
      expect(find.text('ERP71 is locked'), findsNothing);
      expect(find.text('Net sales today'), findsOneWidget);
    });

    testWidgets('a phone whose screen lock was removed is let in and the '
        'lock turned off', (tester) async {
      final storage = signedInPhone(appLock: true);
      await pumpApp(
        tester,
        backend: ownerBackend(),
        storage: storage,
        authenticator: FakeDeviceAuthenticator(
          result: DeviceAuthResult.unavailable,
        ),
      );

      expect(find.text('ERP71 is locked'), findsNothing);
      expect(storage.values, isNot(contains(AppLockController.storageKey)));
    });
  });
}
