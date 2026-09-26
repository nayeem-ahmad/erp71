import 'dart:convert';

import 'package:erp71_mobile/config/app_config.dart';
import 'package:erp71_mobile/core/auth/auth_controller.dart';
import 'package:erp71_mobile/core/auth/auth_repository.dart';
import 'package:erp71_mobile/core/auth/google_auth.dart';
import 'package:erp71_mobile/core/auth/token_store.dart';
import 'package:erp71_mobile/core/providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fake_backend.dart';
import '../support/fixtures.dart';

void main() {
  late FakeBackend backend;
  late FakeGoogleAuth google;
  late InMemoryKeyValueStore storage;

  ProviderContainer start() => ProviderContainer.test(
    overrides: [
      appConfigProvider.overrideWithValue(const AppConfig(apiBaseUrl: apiBase)),
      keyValueStoreProvider.overrideWithValue(storage),
      httpClientProvider.overrideWithValue(backend.client),
      googleAuthProvider.overrideWithValue(google),
    ],
  );

  /// Reads the controller and lets its launch-time restore finish.
  Future<AuthState> settle(ProviderContainer container) async {
    container.read(authControllerProvider);
    for (var i = 0; i < 20; i++) {
      await Future<void>.delayed(Duration.zero);
      if (container.read(authControllerProvider) is! AuthRestoring) break;
    }
    return container.read(authControllerProvider);
  }

  Future<void> storeSession({String? tenantId, String? storeId}) async {
    final tokens = TokenStore(storage);
    await tokens.saveTokens(
      SessionTokens(
        accessToken: 'stored-access',
        refreshToken: 'stored-refresh',
        accessTokenExpiresAt: DateTime.now().add(const Duration(hours: 1)),
      ),
    );
    await tokens.saveContext(tenantId: tenantId, storeId: storeId);
  }

  setUp(() {
    backend = FakeBackend();
    google = FakeGoogleAuth();
    storage = InMemoryKeyValueStore();
    backend.on(
      'GET',
      '/auth/google/config',
      (_) => {'enabled': true, 'client_id': 'web-client'},
    );
  });

  group('launch', () {
    test('with nothing stored, asks the user to sign in', () async {
      final container = start();

      expect(await settle(container), isA<AuthSignedOut>());
      expect(backend.requests, isEmpty);
    });

    test('resumes a stored session in the workspace used last time', () async {
      await storeSession(tenantId: 'tenant-2');
      backend.on(
        'GET',
        '/auth/me',
        (_) => meJson(
          tenants: [
            workspaceJson(id: 'tenant-1', name: 'First'),
            workspaceJson(id: 'tenant-2', name: 'Second'),
          ],
        ),
      );

      final state = await settle(start()) as AuthSignedIn;

      expect(state.user.email, 'karim@rahman.com.bd');
      expect(state.workspace!.name, 'Second');
    });

    test(
      'offers the picker when several workspaces and none remembered',
      () async {
        await storeSession();
        backend.on(
          'GET',
          '/auth/me',
          (_) => meJson(
            tenants: [
              workspaceJson(id: 'tenant-1'),
              workspaceJson(id: 'tenant-2'),
            ],
          ),
        );

        final state = await settle(start()) as AuthSignedIn;

        expect(state.workspace, isNull);
      },
    );

    test('signs out, with a reason, when the stored session is dead', () async {
      await storeSession();
      backend.on('GET', '/auth/me', (_) => apiError(401, 'Unauthorized'));
      backend.on(
        'POST',
        '/auth/refresh',
        (_) => apiError(401, 'Session revoked'),
      );

      final state = await settle(start());

      expect(state, isA<AuthSignedOut>());
      expect((state as AuthSignedOut).notice, isNotNull);
      expect(await storage.read('erp71.session.v1'), isNull);
    });

    test(
      'offline at launch is not signed out: the session may be fine',
      () async {
        await storeSession();
        backend.on(
          'GET',
          '/auth/me',
          (_) => apiError(503, 'Service unavailable'),
        );

        expect(await settle(start()), isA<AuthRestoreFailed>());
        expect(await storage.read('erp71.session.v1'), isNotNull);
      },
    );
  });

  group('Google sign-in', () {
    test('exchanges the ID token and enters the only workspace', () async {
      backend.on('POST', '/auth/google', (_) => authResponse());
      final container = start();
      await settle(container);

      await container.read(authControllerProvider.notifier).signInWithGoogle();

      final state = container.read(authControllerProvider) as AuthSignedIn;
      expect(state.workspace!.id, 'tenant-1');
      expect(state.branch!.id, 'store-1');
      // The backend's web client is the audience it already accepts.
      expect(google.lastServerClientId, 'web-client');
      expect(backend.lastBody('POST', '/auth/google'), {
        'credential': 'google-id-token',
        'remember_me': true,
      });
      final stored =
          jsonDecode((await storage.read('erp71.session.v1'))!) as Map;
      expect(stored['refresh_token'], 'refresh-1');
      expect(await storage.read('erp71.tenant.v1'), 'tenant-1');
      expect(await storage.read('erp71.store.v1'), 'store-1');
    });

    test('does nothing when the user backs out of Google', () async {
      google.idToken = null;
      final container = start();
      await settle(container);

      await container.read(authControllerProvider.notifier).signInWithGoogle();

      expect(container.read(authControllerProvider), isA<AuthSignedOut>());
      expect(backend.sent('POST', '/auth/google'), isEmpty);
    });

    test('says so when the server has Google sign-in turned off', () async {
      backend.on(
        'GET',
        '/auth/google/config',
        (_) => {'enabled': false, 'client_id': null},
      );
      final container = start();
      await settle(container);

      await expectLater(
        container.read(authControllerProvider.notifier).signInWithGoogle(),
        throwsA(isA<GoogleAuthException>()),
      );
    });

    test(
      'does not create accounts: an unknown address is sent to the web',
      () async {
        // The backend refuses to create an account without accepted terms, and
        // the app never sends them.
        backend.on(
          'POST',
          '/auth/google',
          (_) =>
              apiError(400, 'Please accept the Terms of Service to continue.'),
        );
        final container = start();
        await settle(container);

        await expectLater(
          container.read(authControllerProvider.notifier).signInWithGoogle(),
          throwsA(isA<NoAccountForGoogle>()),
        );
        expect(
          backend
              .lastBody('POST', '/auth/google')
              .containsKey('acceptedTermsVersion'),
          isFalse,
        );
        // So the next attempt can pick a different Google account.
        expect(google.signOuts, 1);
      },
    );

    test('asks for the authenticator code, then finishes signing in', () async {
      backend.on(
        'POST',
        '/auth/google',
        (_) => {'requires_2fa': true, 'user_id': 'user-1'},
      );
      backend.on('POST', '/auth/2fa/verify', (_) => authResponse());
      final container = start();
      await settle(container);
      final controller = container.read(authControllerProvider.notifier);

      await controller.signInWithGoogle();
      expect(container.read(authControllerProvider), isA<AuthNeedsTwoFactor>());

      await controller.verifyTwoFactor('123456');

      expect(container.read(authControllerProvider), isA<AuthSignedIn>());
      expect(backend.lastBody('POST', '/auth/2fa/verify'), {
        'userId': 'user-1',
        'code': '123456',
        'remember_me': true,
      });
    });
  });

  group('workspaces and branches', () {
    test(
      'keeps the branch chosen before, and falls back to the first',
      () async {
        await storeSession(tenantId: 'tenant-1', storeId: 'store-2');
        backend.on(
          'GET',
          '/auth/me',
          (_) => meJson(
            tenants: [
              workspaceJson(
                stores: const [
                  {'id': 'store-1', 'name': 'Main Store'},
                  {'id': 'store-2', 'name': 'Uttara Branch'},
                ],
              ),
            ],
          ),
        );
        final container = start();

        final state = await settle(container) as AuthSignedIn;
        expect(state.branch!.name, 'Uttara Branch');

        await container
            .read(authControllerProvider.notifier)
            .selectBranch(state.workspace!.branches.first);
        expect(
          (container.read(authControllerProvider) as AuthSignedIn).branch!.id,
          'store-1',
        );
        expect(await storage.read('erp71.store.v1'), 'store-1');
      },
    );

    test('switching workspace moves the requests to it', () async {
      await storeSession(tenantId: 'tenant-1');
      backend.on(
        'GET',
        '/auth/me',
        (_) => meJson(
          tenants: [
            workspaceJson(id: 'tenant-1'),
            workspaceJson(
              id: 'tenant-2',
              stores: const [
                {'id': 'store-9', 'name': 'Chattogram'},
              ],
            ),
          ],
        ),
      );
      final container = start();
      final state = await settle(container) as AuthSignedIn;

      await container
          .read(authControllerProvider.notifier)
          .selectWorkspace(state.workspaces.last);

      final tokens = container.read(tokenStoreProvider);
      expect(tokens.tenantId, 'tenant-2');
      expect(tokens.storeId, 'store-9');
    });
  });

  group('signing out', () {
    test('ends only this device\'s session and forgets the tokens', () async {
      backend.on('POST', '/auth/google', (_) => authResponse());
      backend.on('POST', '/auth/logout/session', (_) => null);
      final container = start();
      await settle(container);
      final controller = container.read(authControllerProvider.notifier);
      await controller.signInWithGoogle();

      await controller.signOut();

      expect(container.read(authControllerProvider), isA<AuthSignedOut>());
      expect(backend.lastBody('POST', '/auth/logout/session'), {
        'refresh_token': 'refresh-1',
      });
      // "/auth/logout" would sign the user out of the web too.
      expect(backend.sent('POST', '/auth/logout'), isEmpty);
      expect(await storage.read('erp71.session.v1'), isNull);
      expect(google.signOuts, 1);
    });

    test('still signs out when the server cannot be told', () async {
      backend.on('POST', '/auth/google', (_) => authResponse());
      backend.on(
        'POST',
        '/auth/logout/session',
        (_) => apiError(404, 'Cannot POST'),
      );
      final container = start();
      await settle(container);
      final controller = container.read(authControllerProvider.notifier);
      await controller.signInWithGoogle();

      await controller.signOut();

      expect(container.read(authControllerProvider), isA<AuthSignedOut>());
      expect(await storage.read('erp71.session.v1'), isNull);
    });

    test('a session revoked elsewhere returns the app to sign-in', () async {
      backend.on('POST', '/auth/google', (_) => authResponse());
      backend.on(
        'GET',
        '/crm/leads',
        (_) => apiError(401, 'Session invalidated'),
      );
      backend.on(
        'POST',
        '/auth/refresh',
        (_) => apiError(401, 'Session revoked'),
      );
      final container = start();
      await settle(container);
      await container.read(authControllerProvider.notifier).signInWithGoogle();

      await expectLater(
        container.read(apiClientProvider).getPage('/crm/leads'),
        throwsA(anything),
      );

      final state = container.read(authControllerProvider);
      expect(state, isA<AuthSignedOut>());
      expect((state as AuthSignedOut).notice, isNotNull);
    });
  });
}
