import 'package:erp71_mobile/config/app_config.dart';
import 'package:erp71_mobile/core/auth/token_store.dart';
import 'package:erp71_mobile/core/providers.dart';
import 'package:erp71_mobile/core/security/app_lock.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fake_backend.dart';
import '../support/fixtures.dart';

void main() {
  late InMemoryKeyValueStore storage;
  late FakeDeviceAuthenticator authenticator;
  late FakeBackend backend;

  ProviderContainer start() => ProviderContainer.test(
    overrides: [
      appConfigProvider.overrideWithValue(const AppConfig(apiBaseUrl: apiBase)),
      keyValueStoreProvider.overrideWithValue(storage),
      httpClientProvider.overrideWithValue(backend.client),
      googleAuthProvider.overrideWithValue(FakeGoogleAuth()),
      deviceAuthenticatorProvider.overrideWithValue(authenticator),
    ],
  );

  Future<AppLockState> loaded(ProviderContainer container) async {
    container.read(appLockProvider);
    for (var i = 0; i < 10 && !container.read(appLockProvider).loaded; i++) {
      await Future<void>.delayed(Duration.zero);
    }
    return container.read(appLockProvider);
  }

  /// A phone with a live session: the lock only ever covers a signed-in app.
  Future<void> signedIn() async {
    final tokens = TokenStore(storage);
    await tokens.saveTokens(
      SessionTokens(
        accessToken: 'access',
        refreshToken: 'refresh',
        accessTokenExpiresAt: DateTime.now().add(const Duration(hours: 1)),
      ),
    );
    await tokens.saveContext(tenantId: 'tenant-1', storeId: 'store-1');
  }

  setUp(() {
    storage = InMemoryKeyValueStore();
    authenticator = FakeDeviceAuthenticator();
    backend = FakeBackend()..on('GET', '/auth/me', (_) => meJson());
  });

  test('off by default, and nothing is ever covered', () async {
    final container = start();
    final state = await loaded(container);
    expect(state.enabled, isFalse);
    expect(state.locked, isFalse);

    final lock = container.read(appLockProvider.notifier);
    final t = DateTime(2026, 10, 7, 9);
    lock.hidden(now: t);
    lock.shown(now: t.add(const Duration(hours: 3)));
    expect(container.read(appLockProvider).locked, isFalse);
  });

  test(
    'on: locked at launch, and again only after five minutes away',
    () async {
      await signedIn();
      storage.values[AppLockController.storageKey] = '1';
      final container = start();
      expect((await loaded(container)).locked, isTrue);

      final lock = container.read(appLockProvider.notifier);
      expect(await lock.unlock(), isTrue);
      expect(container.read(appLockProvider).locked, isFalse);

      final t = DateTime(2026, 10, 7, 9);
      // A quick look at the calculator does not ask again.
      lock.hidden(now: t);
      lock.shown(now: t.add(const Duration(minutes: 4, seconds: 59)));
      expect(container.read(appLockProvider).locked, isFalse);

      lock.hidden(now: t);
      lock.shown(now: t.add(AppLockController.gracePeriod));
      expect(container.read(appLockProvider).locked, isTrue);
    },
  );

  test('coming back without having left does not lock', () async {
    await signedIn();
    storage.values[AppLockController.storageKey] = '1';
    final container = start();
    await loaded(container);
    final lock = container.read(appLockProvider.notifier);
    await lock.unlock();

    // A "shown" with no "hidden" before it: the fingerprint prompt closing.
    lock.shown(now: DateTime(2030));
    expect(container.read(appLockProvider).locked, isFalse);
  });

  test('a failed check keeps it locked; turning it off unlocks', () async {
    await signedIn();
    storage.values[AppLockController.storageKey] = '1';
    authenticator.result = DeviceAuthResult.failed;
    final container = start();
    await loaded(container);
    final lock = container.read(appLockProvider.notifier);

    expect(await lock.unlock(), isFalse);
    expect(container.read(appLockProvider).locked, isTrue);

    await lock.disable();
    expect(container.read(appLockProvider).locked, isFalse);
    expect(storage.values, isNot(contains(AppLockController.storageKey)));
  });

  test('turning it on is refused when the check is cancelled', () async {
    authenticator.result = DeviceAuthResult.failed;
    final container = start();
    await loaded(container);

    expect(
      await container.read(appLockProvider.notifier).enable(),
      AppLockEnableResult.cancelled,
    );
    expect(container.read(appLockProvider).enabled, isFalse);
    expect(storage.values, isNot(contains(AppLockController.storageKey)));
  });

  test('a session that is already over at launch is not locked', () async {
    // No stored session: the app opens on sign-in, and a fresh Google
    // sign-in must not then meet a lock.
    storage.values[AppLockController.storageKey] = '1';
    final container = start();
    final state = await loaded(container);
    expect(state.enabled, isTrue);
    expect(state.locked, isFalse);
  });
}
