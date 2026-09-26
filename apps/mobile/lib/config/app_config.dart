/// Settings baked in at build time with `--dart-define` (see the README).
class AppConfig {
  const AppConfig({required this.apiBaseUrl});

  /// The API root including the NestJS global prefix, without a trailing
  /// slash: `https://api.erp71.com/api/v1` in production. A local backend is
  /// `http://10.0.2.2:4000/api/v1` from the Android emulator, or
  /// `http://localhost:4000/api/v1` from the iOS simulator.
  final String apiBaseUrl;

  static const String _apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://api.erp71.com/api/v1',
  );

  factory AppConfig.fromEnvironment() =>
      AppConfig(apiBaseUrl: normalizeBaseUrl(_apiBaseUrl));

  static String normalizeBaseUrl(String raw) {
    var url = raw.trim();
    while (url.endsWith('/')) {
      url = url.substring(0, url.length - 1);
    }
    return url;
  }
}
