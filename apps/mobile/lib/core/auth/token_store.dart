import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// The credentials of one signed-in session.
class SessionTokens {
  const SessionTokens({
    required this.accessToken,
    required this.refreshToken,
    required this.accessTokenExpiresAt,
  });

  /// Reads the `access_token` / `refresh_token` / `expires_in` trio that every
  /// sign-in and `/auth/refresh` answer carries.
  factory SessionTokens.fromAuthResponse(
    Map<String, dynamic> json, {
    DateTime? now,
  }) {
    final expiresIn = json['expires_in'];
    return SessionTokens(
      accessToken: json['access_token'] as String,
      refreshToken: json['refresh_token'] as String,
      accessTokenExpiresAt: (now ?? DateTime.now()).add(
        Duration(seconds: expiresIn is num ? expiresIn.toInt() : 3600),
      ),
    );
  }

  final String accessToken;

  /// Rotated by every `/auth/refresh`: the old one stops working the moment a
  /// new one is issued, so it must be persisted before anything else happens.
  final String refreshToken;

  final DateTime accessTokenExpiresAt;

  bool expiresWithin(Duration window, DateTime now) =>
      accessTokenExpiresAt.isBefore(now.add(window));

  Map<String, dynamic> toJson() => {
    'access_token': accessToken,
    'refresh_token': refreshToken,
    'access_token_expires_at': accessTokenExpiresAt.toIso8601String(),
  };

  static SessionTokens? tryParse(String? raw) {
    if (raw == null || raw.isEmpty) return null;
    try {
      final json = jsonDecode(raw) as Map<String, dynamic>;
      return SessionTokens(
        accessToken: json['access_token'] as String,
        refreshToken: json['refresh_token'] as String,
        accessTokenExpiresAt: DateTime.parse(
          json['access_token_expires_at'] as String,
        ),
      );
    } catch (_) {
      // Written by an older build in a shape this one does not know. Treat it
      // as signed out rather than crashing on launch.
      return null;
    }
  }
}

/// The few strings the app keeps between launches. An interface so tests can
/// swap the platform keychain for a map.
abstract class KeyValueStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

/// Android Keystore / iOS Keychain backed storage.
class SecureKeyValueStore implements KeyValueStore {
  SecureKeyValueStore([FlutterSecureStorage? storage])
    : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;

  @override
  Future<String?> read(String key) => _storage.read(key: key);

  @override
  Future<void> write(String key, String value) =>
      _storage.write(key: key, value: value);

  @override
  Future<void> delete(String key) => _storage.delete(key: key);
}

class InMemoryKeyValueStore implements KeyValueStore {
  final Map<String, String> values = {};

  @override
  Future<String?> read(String key) async => values[key];

  @override
  Future<void> write(String key, String value) async => values[key] = value;

  @override
  Future<void> delete(String key) async => values.remove(key);
}

/// Holds the session tokens and the chosen workspace in memory, and mirrors
/// them to secure storage so a relaunch resumes where the user left off.
class TokenStore {
  TokenStore(this._storage);

  static const _tokensKey = 'erp71.session.v1';
  static const _tenantKey = 'erp71.tenant.v1';
  static const _storeKey = 'erp71.store.v1';

  final KeyValueStore _storage;

  SessionTokens? _tokens;
  String? _tenantId;
  String? _storeId;

  SessionTokens? get tokens => _tokens;

  /// The workspace every request is sent for (`x-tenant-id`).
  String? get tenantId => _tenantId;

  /// The branch whose permissions requests are checked against
  /// (`x-store-id`).
  String? get storeId => _storeId;

  Future<void> load() async {
    _tokens = SessionTokens.tryParse(await _storage.read(_tokensKey));
    _tenantId = await _storage.read(_tenantKey);
    _storeId = await _storage.read(_storeKey);
  }

  Future<void> saveTokens(SessionTokens tokens) async {
    _tokens = tokens;
    await _storage.write(_tokensKey, jsonEncode(tokens.toJson()));
  }

  /// Chooses the workspace and branch together, since a branch only means
  /// something inside its workspace.
  Future<void> saveContext({String? tenantId, String? storeId}) async {
    _tenantId = tenantId;
    _storeId = storeId;
    await _put(_tenantKey, tenantId);
    await _put(_storeKey, storeId);
  }

  Future<void> _put(String key, String? value) =>
      value == null ? _storage.delete(key) : _storage.write(key, value);

  /// Forgets the session. The workspace choice survives on purpose: the same
  /// person signing back in lands in the shop they were last using, and a
  /// different person's sign-in discards it because it is not one of theirs.
  Future<void> clearTokens() async {
    _tokens = null;
    await _storage.delete(_tokensKey);
  }
}
