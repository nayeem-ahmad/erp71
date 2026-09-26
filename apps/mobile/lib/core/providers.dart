import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;

import '../config/app_config.dart';
import 'api/api_client.dart';
import 'auth/auth_repository.dart';
import 'auth/google_auth.dart';
import 'auth/token_store.dart';

// The app's singletons. Tests override the leaves (config, storage, HTTP,
// Google) and get the real wiring for everything above them.

final appConfigProvider = Provider<AppConfig>(
  (ref) => AppConfig.fromEnvironment(),
);

final keyValueStoreProvider = Provider<KeyValueStore>(
  (ref) => SecureKeyValueStore(),
);

final httpClientProvider = Provider<http.Client>((ref) {
  final client = http.Client();
  ref.onDispose(client.close);
  return client;
});

final tokenStoreProvider = Provider<TokenStore>(
  (ref) => TokenStore(ref.watch(keyValueStoreProvider)),
);

final apiClientProvider = Provider<ApiClient>(
  (ref) => ApiClient(
    baseUrl: ref.watch(appConfigProvider).apiBaseUrl,
    tokens: ref.watch(tokenStoreProvider),
    httpClient: ref.watch(httpClientProvider),
  ),
);

final authRepositoryProvider = Provider<AuthRepository>(
  (ref) => AuthRepository(ref.watch(apiClientProvider)),
);

final googleAuthProvider = Provider<GoogleAuth>((ref) => PluginGoogleAuth());
