import '../api/api_client.dart';
import '../api/api_exception.dart';
import 'models.dart';
import 'token_store.dart';

/// What `/auth/google` (or the 2FA step after it) answered.
sealed class SignInOutcome {
  const SignInOutcome();
}

/// Signed in: tokens issued, workspaces listed.
class SignedIn extends SignInOutcome {
  const SignedIn({
    required this.tokens,
    required this.user,
    required this.workspaces,
  });

  final SessionTokens tokens;
  final AuthUser user;
  final List<Workspace> workspaces;
}

/// The account has an authenticator app; a 6-digit code finishes sign-in.
class TwoFactorRequired extends SignInOutcome {
  const TwoFactorRequired(this.userId);

  final String userId;
}

/// Google vouched for an address no ERP71 account uses.
class NoAccountForGoogle implements Exception {
  const NoAccountForGoogle();

  String get message =>
      'No ERP71 account uses this Google address yet. Create your workspace '
      'at app.erp71.com, or ask your shop owner to invite this address, then '
      'sign in here.';
}

class GoogleConfig {
  const GoogleConfig({required this.enabled, this.clientId});

  final bool enabled;

  /// The backend's web OAuth client, used as the phone's server client id.
  final String? clientId;
}

class AuthRepository {
  AuthRepository(this._api);

  final ApiClient _api;

  Future<GoogleConfig> googleConfig() async {
    final json =
        await _api.get('/auth/google/config', authenticated: false)
            as Map<String, dynamic>;
    final clientId = json['client_id'] as String?;
    return GoogleConfig(
      enabled: json['enabled'] == true && (clientId?.isNotEmpty ?? false),
      clientId: clientId,
    );
  }

  /// Exchanges a Google ID token for an ERP71 session.
  ///
  /// Signing up is the web's job: a new account needs the terms accepted and
  /// usually a workspace created, which is a form this app does not have. So
  /// this never sends `acceptedTermsVersion`, and the backend refuses, with a
  /// 400 and before writing anything, to create an account without it. That
  /// refusal is the only 400 this endpoint gives a well-formed request, and
  /// it is turned into [NoAccountForGoogle].
  Future<SignInOutcome> signInWithGoogle(String idToken) async {
    try {
      final json =
          await _api.post(
                '/auth/google',
                authenticated: false,
                body: {'credential': idToken, 'remember_me': true},
              )
              as Map<String, dynamic>;
      return _outcome(json);
    } on ApiException catch (e) {
      if (e.statusCode == 400) throw const NoAccountForGoogle();
      rethrow;
    }
  }

  Future<SignInOutcome> verifyTwoFactor({
    required String userId,
    required String code,
  }) async {
    final json =
        await _api.post(
              '/auth/2fa/verify',
              authenticated: false,
              body: {'userId': userId, 'code': code, 'remember_me': true},
            )
            as Map<String, dynamic>;
    return _outcome(json);
  }

  /// The user and their workspaces, for a session resumed from storage.
  Future<(AuthUser, List<Workspace>)> me() async {
    final json = await _api.get('/auth/me') as Map<String, dynamic>;
    return (AuthUser.fromJson(json), _workspaces(json['tenants']));
  }

  /// Ends this phone's session on the server, leaving the user's other
  /// sessions — the web app, other phones — signed in. (`/auth/logout` would
  /// sign them out everywhere.)
  ///
  /// Best effort: offline, or a backend that predates the endpoint, the
  /// tokens still leave the phone, which is what signing out has to guarantee.
  Future<void> endSession(String refreshToken) async {
    try {
      await _api.post(
        '/auth/logout/session',
        authenticated: false,
        body: {'refresh_token': refreshToken},
      );
    } on ApiException {
      // See above.
    }
  }

  SignInOutcome _outcome(Map<String, dynamic> json) {
    if (json['requires_2fa'] == true) {
      return TwoFactorRequired(json['user_id'] as String);
    }
    return SignedIn(
      tokens: SessionTokens.fromAuthResponse(json),
      user: AuthUser.fromJson(json['user'] as Map<String, dynamic>),
      workspaces: _workspaces(json['tenants']),
    );
  }

  static List<Workspace> _workspaces(Object? raw) => [
    for (final t in (raw as List<dynamic>? ?? const []))
      if (t is Map<String, dynamic>) Workspace.fromJson(t),
  ];
}
