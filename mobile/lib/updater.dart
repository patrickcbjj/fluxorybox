import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:package_info_plus/package_info_plus.dart';
import 'package:path_provider/path_provider.dart';
import 'package:open_filex/open_filex.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'api.dart';

const _muted = Color(0xFF7D8598);
const _accent = Color(0xFF6D7CFF);

/// Sistema de atualização in-app do FluxoryBox.
/// O site (mesmo backend) publica um `version.json`; o app compara com a build
/// instalada, baixa o APK e dispara o instalador do Android (que pede aprovação).
class Updater {
  /// Checa se há versão nova. Se houver, mostra o diálogo de atualização.
  /// [auto]: checagem automática no launch — respeita "dispensar" e não avisa se já está atualizado.
  static Future<void> check(BuildContext context, {bool auto = true}) async {
    if (Api.baseUrl.isEmpty) return;
    Map? remote;
    try {
      final res = await http
          .get(Uri.parse('${Api.baseUrl}/version.json'))
          .timeout(const Duration(seconds: 8));
      if (res.statusCode != 200) return;
      remote = jsonDecode(res.body) as Map;
    } catch (_) {
      if (!auto && context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Não foi possível checar atualizações.')));
      }
      return;
    }

    final info = await PackageInfo.fromPlatform();
    final installed = int.tryParse(info.buildNumber) ?? 0;
    final remoteCode = remote['versionCode'] is int
        ? remote['versionCode'] as int
        : int.tryParse('${remote['versionCode']}') ?? 0;

    if (remoteCode <= installed) {
      if (!auto && context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Você já está na versão mais recente.')));
      }
      return;
    }

    if (auto) {
      final p = await SharedPreferences.getInstance();
      if (p.getInt('update_dismissed') == remoteCode) return; // já dispensou esta versão
    }

    final apkUrl = _absolute(remote['apkUrl']?.toString() ?? '');
    if (apkUrl.isEmpty || !context.mounted) return;

    await showDialog(
      context: context,
      barrierDismissible: false,
      builder: (_) => _UpdateDialog(
        versionName: remote!['versionName']?.toString() ?? '',
        notes: remote['notes']?.toString() ?? '',
        apkUrl: apkUrl,
        versionCode: remoteCode,
      ),
    );
  }

  static String _absolute(String url) {
    if (url.isEmpty) return '';
    if (url.startsWith('http')) return url;
    return '${Api.baseUrl}${url.startsWith('/') ? '' : '/'}$url';
  }
}

class _UpdateDialog extends StatefulWidget {
  final String versionName;
  final String notes;
  final String apkUrl;
  final int versionCode;
  const _UpdateDialog({
    required this.versionName,
    required this.notes,
    required this.apkUrl,
    required this.versionCode,
  });
  @override
  State<_UpdateDialog> createState() => _UpdateDialogState();
}

class _UpdateDialogState extends State<_UpdateDialog> {
  bool _downloading = false;
  double _progress = 0;
  String? _error;

  Future<void> _dismiss() async {
    final p = await SharedPreferences.getInstance();
    await p.setInt('update_dismissed', widget.versionCode);
    if (mounted) Navigator.pop(context);
  }

  Future<void> _downloadAndInstall() async {
    setState(() { _downloading = true; _error = null; _progress = 0; });
    try {
      final req = http.Request('GET', Uri.parse(widget.apkUrl));
      final resp = await http.Client().send(req);
      if (resp.statusCode != 200) throw 'HTTP ${resp.statusCode}';
      final total = resp.contentLength ?? 0;
      final bytes = <int>[];
      await for (final chunk in resp.stream) {
        bytes.addAll(chunk);
        if (total > 0 && mounted) setState(() => _progress = bytes.length / total);
      }
      final dir = await getTemporaryDirectory();
      final path = '${dir.path}/FluxoryBox-update.apk';
      final file = File(path);
      await file.writeAsBytes(bytes, flush: true);
      // Dispara o instalador do Android — a tela de "Instalar?" é a aprovação do usuário.
      final res = await OpenFilex.open(path, type: 'application/vnd.android.package-archive');
      if (res.type != ResultType.done) {
        setState(() { _error = 'Não foi possível abrir o instalador (${res.message}).'; _downloading = false; });
        return;
      }
      if (mounted) Navigator.pop(context);
    } catch (e) {
      setState(() { _error = 'Falha ao baixar: $e'; _downloading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Row(children: [
        const Icon(Icons.system_update_rounded, color: _accent),
        const SizedBox(width: 10),
        Expanded(child: Text('Atualização ${widget.versionName}'.trim())),
      ]),
      content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('Uma nova versão do FluxoryBox está disponível.'),
        if (widget.notes.isNotEmpty) ...[
          const SizedBox(height: 12),
          Text(widget.notes, style: const TextStyle(fontSize: 13, color: _muted)),
        ],
        if (_downloading) ...[
          const SizedBox(height: 18),
          LinearProgressIndicator(value: _progress > 0 ? _progress : null),
          const SizedBox(height: 6),
          Text(_progress > 0 ? 'Baixando ${(_progress * 100).toStringAsFixed(0)}%' : 'Baixando...',
              style: const TextStyle(fontSize: 12, color: _muted)),
        ],
        if (_error != null) ...[
          const SizedBox(height: 12),
          Text(_error!, style: const TextStyle(color: Colors.redAccent, fontSize: 13)),
        ],
      ]),
      actions: _downloading
          ? null
          : [
              TextButton(onPressed: _dismiss, child: const Text('Depois')),
              FilledButton.icon(
                onPressed: _downloadAndInstall,
                icon: const Icon(Icons.download_rounded, size: 18),
                label: const Text('Baixar e instalar'),
              ),
            ],
    );
  }
}
