import 'package:erp71_mobile/app/app.dart';
import 'package:erp71_mobile/config/app_config.dart';
import 'package:erp71_mobile/core/auth/token_store.dart';
import 'package:erp71_mobile/core/format/format.dart';
import 'package:erp71_mobile/core/providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fake_backend.dart';
import 'fixtures.dart';

/// The whole app against [backend], on a 360 × 780 phone — the narrowest
/// width the UI rules require to work without horizontal scrolling. A layout
/// that overflows fails the test.
Future<void> pumpApp(
  WidgetTester tester, {
  required FakeBackend backend,
  FakeGoogleAuth? google,
  InMemoryKeyValueStore? storage,
}) async {
  tester.view.physicalSize = const Size(1080, 2340);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  addTearDown(() => setActiveTimeZone(null));

  await tester.pumpWidget(
    ProviderScope(
      retry: (_, _) => null,
      overrides: [
        appConfigProvider.overrideWithValue(
          const AppConfig(apiBaseUrl: apiBase),
        ),
        keyValueStoreProvider.overrideWithValue(
          storage ?? InMemoryKeyValueStore(),
        ),
        httpClientProvider.overrideWithValue(backend.client),
        googleAuthProvider.overrideWithValue(google ?? FakeGoogleAuth()),
      ],
      child: const Erp71App(),
    ),
  );
  await tester.pumpAndSettle();
}

/// A backend with a signed-in-able account and a working CRM, which tests
/// then adjust. Dates are relative to now so labels like "Today" hold on
/// whatever day the suite runs.
FakeBackend crmBackend() {
  final backend = FakeBackend();
  final soon = DateTime.now()
      .toUtc()
      .add(const Duration(hours: 1))
      .toIso8601String();
  final earlier = DateTime.now()
      .toUtc()
      .subtract(const Duration(days: 2))
      .toIso8601String();

  backend
    ..on(
      'GET',
      '/auth/google/config',
      (_) => {'enabled': true, 'client_id': 'web-client'},
    )
    ..on('POST', '/auth/google', (_) => authResponse())
    ..on('POST', '/auth/logout/session', (_) => null)
    ..on('GET', '/crm/dashboard/overview', (_) => overviewJson())
    ..on(
      'GET',
      '/crm/leads',
      (_) => page([
        leadJson(nextStepDate: soon),
        leadJson(
          id: 'lead-2',
          name: 'Salma Begum',
          status: 'NEW',
          nextStep: null,
          score: 20,
        ),
      ]),
    )
    ..on('GET', '/crm/leads/lead-1', (_) => leadJson(nextStepDate: soon))
    ..on('GET', '/crm/activities', (request) {
      final q = request.url.queryParameters;
      if (q['leadId'] == 'lead-1') {
        return page([
          activityJson(dueAt: soon),
          activityJson(
            id: 'act-0',
            status: 'DONE',
            subject: null,
            summary: 'Asked for the price list',
            completedAt: earlier,
          ),
        ]);
      }
      return page([activityJson(dueAt: soon)]);
    })
    ..on('GET', '/crm/contacts', (_) => page([contactJson()]))
    ..on('GET', '/crm/contacts/contact-1', (_) => contactJson())
    ..on('GET', '/crm/lead-taxonomy/channels', (_) => channelsJson())
    ..on('GET', '/crm/lead-taxonomy/purposes', (_) => <Object?>[])
    ..on('GET', '/crm/lead-taxonomy/sources', (_) => <Object?>[])
    ..on('GET', '/crm/lead-taxonomy/categories', (_) => <Object?>[]);
  return backend;
}

/// From the sign-in screen, through Google, onto the Overview.
Future<void> signInWithGoogle(WidgetTester tester) async {
  await tester.tap(find.text('Continue with Google'));
  await tester.pumpAndSettle();
}
