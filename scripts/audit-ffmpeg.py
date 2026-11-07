#!/usr/bin/env python3
"""Collect local FFmpeg evidence, never a distribution approval."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

CASES = [('libmp3lame', 'mp3', 'mp3'), ('flac', 'flac', 'flac'),
         ('pcm_s16le', 'wav', 'pcm_s16le'), ('pcm_s24le', 'wav', 'pcm_s24le'),
         ('aac', 'm4a', 'aac'), ('libvorbis', 'ogg', 'vorbis'), ('libopus', 'opus', 'opus')]


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def run(args):
    try:
        p = subprocess.run([str(a) for a in args], capture_output=True, timeout=90)
        return {'args': [str(a) for a in args], 'returncode': p.returncode,
                'stdout': p.stdout.decode('utf-8', errors='replace'),
                'stderr': p.stderr.decode('utf-8', errors='replace')}
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {'args': [str(a) for a in args], 'returncode': None, 'error': str(exc)}


def collect(ffmpeg, ffprobe, package, archive, scratch=None):
    files = []
    for root, dirs, names in os.walk(package, followlinks=False):
        dirs.sort(); names.sort()
        for name in names:
            path = Path(root) / name
            if path.is_symlink():
                raise ValueError(f'symlink not supported: {path}')
            files.append({'path': path.relative_to(package).as_posix(),
                          'bytes': path.stat().st_size, 'sha256': digest(path)})
        if any((Path(root) / d).is_symlink() for d in dirs):
            raise ValueError('symlink directory not supported')
    commands = {}
    for flag in ('-version', '-buildconf', '-L', '-encoders', '-decoders', '-formats', '-filters'):
        commands['ffmpeg ' + flag] = run([ffmpeg, '-hide_banner', flag])
    commands['ffprobe -version'] = run([ffprobe, '-hide_banner', '-version'])
    tests = []
    with tempfile.TemporaryDirectory(prefix='forma-ffmpeg-audit-', dir=scratch) as tmp:
        for encoder, ext, expected in CASES:
            output = Path(tmp) / ('tone.' + ext)
            encode = run([ffmpeg, '-nostdin', '-v', 'error', '-f', 'lavfi', '-i',
                          'sine=frequency=1000:duration=1:sample_rate=48000',
                          '-c:a', encoder, '-y', output])
            probe = run([ffprobe, '-v', 'error', '-select_streams', 'a:0', '-show_entries',
                         'stream=codec_name,sample_rate,bits_per_sample', '-of', 'json', output]) if encode['returncode'] == 0 else None
            codec = None
            if probe and probe['returncode'] == 0:
                try:
                    codec = json.loads(probe['stdout'])['streams'][0]['codec_name']
                except (ValueError, KeyError, IndexError):
                    pass
            tests.append({'encoder': encoder, 'expected_codec': expected, 'detected_codec': codec,
                          'passed': codec == expected, 'encode': encode, 'probe': probe})
    return {'schema': 1, 'collected_utc': datetime.now(timezone.utc).isoformat(),
            'distribution_status': 'NOT_APPROVED',
            'limitations': ['Inventory and synthetic tests do not authenticate provenance, establish licenses or approve distribution.',
                            'DLL imports, corresponding sources, clean Windows and legal review not verified.'],
            'package_directory': str(package), 'archive': ({'path': str(archive), 'bytes': archive.stat().st_size, 'sha256': digest(archive)} if archive else None),
            'executables': {str(p): {'bytes': p.stat().st_size, 'sha256': digest(p)} for p in (ffmpeg, ffprobe)},
            'inventory': files, 'commands': commands, 'synthetic_tests': tests}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ffmpeg', type=Path, required=True)
    parser.add_argument('--ffprobe', type=Path, required=True)
    parser.add_argument('--package-dir', type=Path, required=True, help='Explicit directory to inventory; do not use personal media directories')
    parser.add_argument('--archive', type=Path, help='Optional original archive to hash, never extracted')
    parser.add_argument('--output', type=Path, required=True, help='New JSON output file, outside package directory')
    a = parser.parse_args()
    try:
        ffmpeg, ffprobe, package = a.ffmpeg.resolve(strict=True), a.ffprobe.resolve(strict=True), a.package_dir.resolve(strict=True)
        archive = a.archive.resolve(strict=True) if a.archive else None
        output = a.output.resolve()
        if not package.is_dir() or not ffmpeg.is_file() or not ffprobe.is_file() or (archive and not archive.is_file()):
            raise ValueError('invalid input file or package directory')
        if output.is_relative_to(package) or output in (ffmpeg, ffprobe, archive):
            raise ValueError('output must be outside the package and distinct from inputs')
        if output.exists():
            raise ValueError('output already exists; choose a new file')
        result = collect(ffmpeg, ffprobe, package, archive, output.parent)
        with output.open('x', encoding='utf-8') as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
            f.write('\n')
        passed = sum(t['passed'] for t in result['synthetic_tests'])
        commands_ok = all(c['returncode'] == 0 for c in result['commands'].values())
        print(f'NOT_APPROVED; synthetic tests {passed}/{len(CASES)}; command collection {"ok" if commands_ok else "failed"}; evidence: {output}')
        return 0 if passed == len(CASES) and commands_ok else 1
    except (OSError, ValueError) as exc:
        print(f'audit failed: {exc}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
