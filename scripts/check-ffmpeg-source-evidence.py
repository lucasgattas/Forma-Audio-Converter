#!/usr/bin/env python3
"""Check the frozen local inventory, not licensing or source correspondence."""
import argparse
import hashlib
import re
import sys
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
START = '<!-- evidence-sha256 -->'
END = '<!-- /evidence-sha256 -->'


def check(root, manifest):
    text = manifest.read_text(encoding='utf-8')
    if text.count(START) != 1 or text.count(END) != 1:
        raise ValueError('marcadores do inventário inválidos')
    body = text.split(START, 1)[1].split(END, 1)[0]
    entries = [line for line in body.splitlines() if line.strip()]
    if not entries:
        raise ValueError('inventário vazio')
    seen = set()
    failed = False
    root = root.resolve()
    for line in entries:
        match = re.fullmatch(r'([0-9a-f]{64})  ([^\r\n]+)', line)
        if not match:
            raise ValueError('linha de inventário inválida')
        expected, name = match.groups()
        rel = PurePosixPath(name)
        if rel.is_absolute() or '..' in rel.parts or '\\' in name or ':' in name or name in seen:
            raise ValueError('caminho inválido ou duplicado')
        seen.add(name)
        path = (root / name).resolve()
        if not path.is_relative_to(root):
            raise ValueError('caminho fora da raiz')
        try:
            digest = hashlib.sha256()
            with path.open('rb') as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                    digest.update(chunk)
            if digest.hexdigest() != expected:
                print(f'ALTERADO: {name}')
                failed = True
            else:
                print(f'OK: {name}')
        except OSError as error:
            print(f'AUSENTE/ILEGÍVEL: {name} ({error.__class__.__name__})')
            failed = True
    print(f'Verificados: {len(entries)}; falhas: {"sim" if failed else "não"}. Não avalia completude nem conformidade.')
    return 1 if failed else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--manifest', type=Path, default=ROOT / 'docs/ffmpeg-own-evidence/source-delivery-manifest.md')
    args = parser.parse_args()
    try:
        return check(args.root, args.manifest)
    except (OSError, UnicodeError, ValueError) as error:
        print(f'Inventário inválido ou inacessível: {error}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
