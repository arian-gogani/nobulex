#!/usr/bin/env python3
"""Download and execute the published synthetic benchmark after verifying hashes.
Read this file before running. Requires Python 3 and Node. Does not install packages,
run the historical Python modules, or send results. Hashes bind bytes to this
script's declared baseline; they are not an independent trust endorsement.
"""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import urllib.request

COMMIT = 'b9ef946f87858d120bba9c70730fc3ae1631fc93'
BASE = f'https://raw.githubusercontent.com/arian-gogani/nobulex/{COMMIT}/research/verification-boundaries/'
HASHES = {
    'benchmark.mjs': '5092b0a70a0beab3e14c245605d19b1005aac5250b21cf3bf6348597bc2dfdf6',
    'cases.json': '3acd6aaf79a5de8e86e326185d59774563cbdc3007f60b1b001c46819317f2ed',
    'results.json': 'a5a110dd7ad9d61f52d1f57234fb0a0d1f87bdccad1c38791c050271bb55c335',
    'test.mjs': '7a345fc951022f05cf9c42e42b84c8ed246212e62951ef738164fd1502947426',
}

def checked_bytes(name, data):
    if hashlib.sha256(data).hexdigest() != HASHES[name]:
        raise ValueError(f'{name}: hash mismatch; execution refused')
    return data

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True, help='new report file; existing files are never overwritten')
    args = parser.parse_args()
    if args.output.exists():
        parser.error('output already exists; choose a new path')
    report = {'commit': COMMIT, 'started_at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'scope': 'synthetic benchmark only; successful execution is not independent validation of conclusions',
              'status': 'NOT_COMPLETED', 'verified_files': [], 'runs': []}
    exit_code = 2
    try:
        node = shutil.which('node')
        if not node:
            raise RuntimeError('Node is missing; no analysis ran')
        report['node_version'] = subprocess.check_output([node, '--version'], text=True, timeout=10).strip()
        with tempfile.TemporaryDirectory(prefix='nobulex-review-') as directory:
            for name in HASHES:
                with urllib.request.urlopen(BASE + name, timeout=30) as response:
                    data = checked_bytes(name, response.read())
                Path(directory, name).write_bytes(data)
                report['verified_files'].append({'name': name, 'sha256': HASHES[name]})
            commands = [(['benchmark.mjs'], 0), (['--test', 'test.mjs'], 0)]
            commands += [(['benchmark.mjs', '--mutation', family], 1) for family in ['coverage', 'key-origin', 'policy', 'log', 'preservation']]
            for command, expected in commands:
                result = subprocess.run([node, *command], cwd=directory, capture_output=True, text=True, timeout=60)
                matches = result.returncode == expected
                if expected == 1:
                    matches = matches and 'Reference mismatches:' in result.stdout
                report['runs'].append({'command': ['node', *command], 'expected_exit': expected,
                                       'actual_exit': result.returncode, 'matches': matches,
                                       'stdout': result.stdout, 'stderr': result.stderr})
            exit_code = 0 if all(run['matches'] for run in report['runs']) else 1
            report['status'] = 'EXPECTED_RESULTS' if exit_code == 0 else 'MISMATCH'
    except Exception as error:
        report['error'] = f'{type(error).__name__}: {error}'
    with args.output.open('x') as output:
        json.dump(report, output, indent=2)
        output.write('\n')
    print(f"{report['status']}: {len(report['runs'])} runs recorded in {args.output}")
    return exit_code

if __name__ == '__main__':
    raise SystemExit(main())
