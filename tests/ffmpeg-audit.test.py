import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'audit-ffmpeg.py'
spec = importlib.util.spec_from_file_location('audit_ffmpeg', SCRIPT)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class AuditTests(unittest.TestCase):
    def test_hash_and_synthetic_case_inventory(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / 'x'
            p.write_bytes(b'abc')
            self.assertEqual(audit.digest(p), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
        self.assertEqual(len(audit.CASES), 7)

    def test_rejects_output_inside_package_and_existing_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            package = root / 'package'
            package.mkdir()
            exe = package / 'fake.exe'
            exe.write_bytes(b'not executable')
            for output in (package / 'report.json', exe):
                p = subprocess.run([sys.executable, str(SCRIPT), '--ffmpeg', str(exe), '--ffprobe', str(exe),
                                    '--package-dir', str(package), '--output', str(output)], capture_output=True)
                self.assertEqual(p.returncode, 2)
            self.assertEqual(exe.read_bytes(), b'not executable')

    def test_failed_commands_never_approve(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            package = root / 'package'
            package.mkdir()
            exe = package / 'fake.exe'
            exe.write_bytes(b'not executable')
            result = audit.collect(exe, exe, package, None)
            self.assertEqual(result['distribution_status'], 'NOT_APPROVED')
            self.assertTrue(all(not x['passed'] for x in result['synthetic_tests']))
            self.assertTrue(all(x['returncode'] is None for x in result['commands'].values()))
            self.assertEqual(len(result['inventory']), 1)

if __name__ == '__main__':
    unittest.main()
