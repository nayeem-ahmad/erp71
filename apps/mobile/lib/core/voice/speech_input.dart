import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:speech_to_text/speech_to_text.dart';

/// Turning speech into text on the phone. An interface so tests need no
/// microphone. The words go into the question box for the person to check;
/// nothing is ever sent on the strength of what was heard.
abstract class SpeechInput {
  /// Starts listening in [localeId] (`en_US`, `bn_BD`). [onWords] gets the
  /// words so far and whether they are final; [onDone] fires when listening
  /// stops for any reason. False when the phone cannot listen — no
  /// recognizer, or the microphone was refused.
  Future<bool> start({
    required String localeId,
    required void Function(String words, bool isFinal) onWords,
    required void Function() onDone,
  });

  Future<void> stop();
}

class DeviceSpeechInput implements SpeechInput {
  final SpeechToText _speech = SpeechToText();
  bool? _ready;
  void Function()? _onDone;

  @override
  Future<bool> start({
    required String localeId,
    required void Function(String words, bool isFinal) onWords,
    required void Function() onDone,
  }) async {
    _onDone = onDone;
    _ready ??= await _speech.initialize(
      onStatus: (status) {
        if (status == SpeechToText.doneStatus ||
            status == SpeechToText.notListeningStatus) {
          _onDone?.call();
        }
      },
      onError: (_) => _onDone?.call(),
    );
    if (_ready != true) return false;
    await _speech.listen(
      onResult: (result) => onWords(result.recognizedWords, result.finalResult),
      listenOptions: SpeechListenOptions(
        localeId: localeId,
        partialResults: true,
        listenMode: ListenMode.dictation,
        listenFor: const Duration(seconds: 60),
        pauseFor: const Duration(seconds: 4),
      ),
    );
    return true;
  }

  @override
  Future<void> stop() => _speech.stop();
}

final speechInputProvider = Provider<SpeechInput>((ref) => DeviceSpeechInput());
