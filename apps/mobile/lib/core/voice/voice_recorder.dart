import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:record/record.dart';

/// One clip for Better Bangla. [format] is what Whisper is told (`m4a`).
class RecordedAudio {
  const RecordedAudio({required this.base64, required this.format});

  final String base64;
  final String format;
}

/// Records a question for Whisper. The phone's speech recognizer stays the
/// default; this runs only when Better Bangla is on.
abstract class VoiceRecorder {
  /// False when the microphone was refused or recording could not start.
  /// [onLimit] fires when the clip hits 30 seconds, the same cap as the web.
  Future<bool> start({void Function()? onLimit});

  /// The clip, or null when it was too short to send or nothing was recorded.
  Future<RecordedAudio?> stop();

  Future<void> dispose();
}

class DeviceVoiceRecorder implements VoiceRecorder {
  AudioRecorder? _recorder;
  Timer? _limit;
  String? _path;
  bool _recording = false;

  AudioRecorder get _mic => _recorder ??= AudioRecorder();

  @override
  Future<bool> start({void Function()? onLimit}) async {
    try {
      if (!await _mic.hasPermission()) return false;
      final path =
          '${Directory.systemTemp.path}/erp71-ask-${DateTime.now().microsecondsSinceEpoch}.m4a';
      await _mic.start(
        const RecordConfig(
          encoder: AudioEncoder.aacLc,
          bitRate: 64000,
          sampleRate: 16000,
          numChannels: 1,
        ),
        path: path,
      );
      _path = path;
      _recording = true;
      _limit?.cancel();
      _limit = Timer(const Duration(seconds: 30), () => onLimit?.call());
      return true;
    } catch (_) {
      _recording = false;
      return false;
    }
  }

  @override
  Future<RecordedAudio?> stop() async {
    _limit?.cancel();
    _limit = null;
    if (!_recording && _path == null) return null;
    _recording = false;
    String? stopped;
    try {
      stopped = await _mic.stop();
    } catch (_) {
      stopped = _path;
    }
    final filePath = stopped ?? _path;
    _path = null;
    if (filePath == null) return null;
    final file = File(filePath);
    if (!file.existsSync()) return null;
    try {
      final bytes = await file.readAsBytes();
      // The web sale mic ignores a clip under 1 KB. A tap with no speech
      // is about that, and it is not worth a credit.
      if (bytes.length < 1000) return null;
      return RecordedAudio(base64: base64Encode(bytes), format: 'm4a');
    } finally {
      if (file.existsSync()) {
        try {
          await file.delete();
        } catch (_) {
          // A leftover temp file is harmless.
        }
      }
    }
  }

  @override
  Future<void> dispose() async {
    _limit?.cancel();
    final recorder = _recorder;
    _recorder = null;
    if (recorder != null) await recorder.dispose();
  }
}

final voiceRecorderProvider = Provider<VoiceRecorder>((ref) {
  final recorder = DeviceVoiceRecorder();
  ref.onDispose(recorder.dispose);
  return recorder;
});
