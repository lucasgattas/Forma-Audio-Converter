import hashlib
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/check-ffmpeg-source-evidence.py'


class EvidenceCheck(unittest.TestCase):
    def test_valid_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'source').write_bytes(b'example')
            digest = hashlib.sha256(b'example').hexdigest()
            manifest = root / 'manifest.md'
            manifest.write_text(f'<!-- evidence-sha256 -->\n{digest}  source\n<!-- /evidence-sha256 -->\n', encoding='utf-8')
            result = subprocess.run([sys.executable, str(SCRIPT), '--root', str(root), '--manifest', str(manifest)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)


    def test_missing_and_tampered_files_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'tampered').write_bytes(b'changed')
            digest = hashlib.sha256(b'original').hexdigest()
            manifest = root / 'manifest.md'
            manifest.write_text(f'<!-- evidence-sha256 -->\n{digest}  missing\n{digest}  tampered\n<!-- /evidence-sha256 -->\n', encoding='utf-8')
            result = subprocess.run([sys.executable, str(SCRIPT), '--root', str(root), '--manifest', str(manifest)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            self.assertIn('AUSENTE/ILEGÍVEL: missing', result.stdout)
            self.assertIn('ALTERADO: tampered', result.stdout)

    def test_invalid_inventory_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = root / 'manifest.md'
            for text in ('empty', '<!-- evidence-sha256 -->\n<!-- /evidence-sha256 -->', '<!-- evidence-sha256 -->\n' + 'a' * 64 + '  ../outside\n<!-- /evidence-sha256 -->'):
                manifest.write_text(text, encoding='utf-8')
                result = subprocess.run([sys.executable, str(SCRIPT), '--root', str(root), '--manifest', str(manifest)], capture_output=True, text=True)
                self.assertEqual(result.returncode, 2)


if __name__ == '__main__':
    unittest.main()
