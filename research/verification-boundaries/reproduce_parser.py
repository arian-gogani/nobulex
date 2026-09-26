#!/usr/bin/env python3
"""Replay six scenarios against public, fixed historical parser revisions.

No full repository checkout or dependency installation. The explicit online
flag downloads and executes two hash-pinned Python modules. Review those source
URLs before opting in. This is not an audit of current upstream main.
"""
import argparse
import hashlib
import json
from pathlib import Path
import types
import urllib.request

SOURCES = {
    'before': ('c6d90ee52b82a055b8e68a2b8d2afcb6c53975cb', '8dd2260c8fad53e11915a9009a6fe58b23675a57d123d0dc9292fef6ee09b6af'),
    'after': ('d6889f6ba1ea60a62ea88aea7ce2afc69cc319ec', 'a87db5a79dff472343325c337856fcd6b7a2222f11b85567ae0713de6fdafbbf'),
}
PATH = 'implementations/nobulex/cedar_lite.py'
CASES = [
    ('principal restriction', 'permit (principal == User::"alice", action == Action::"X", resource);', 'X', {}, 'allow', 'REFUSED'),
    ('resource restriction', 'permit (principal, action == Action::"X", resource == File::"/p");', 'X', {}, 'allow', 'REFUSED'),
    ('unless restriction', 'permit (principal, action == Action::"X", resource) unless { context.d == "y" };', 'X', {'d':'y'}, 'allow', 'REFUSED'),
    ('supported unconditional', 'permit (principal, action == Action::"Read", resource);', 'Read', {}, 'allow', 'allow'),
    ('supported matching condition', 'permit (principal, action == Action::"Bash", resource) when { context.command_pattern == "git" };', 'Bash', {'command_pattern':'git'}, 'allow', 'allow'),
    ('supported nonmatching condition', 'permit (principal, action == Action::"Bash", resource) when { context.command_pattern == "git" };', 'Bash', {'command_pattern':'rm'}, 'deny', 'deny'),
]

def main():
    p=argparse.ArgumentParser(description=__doc__)
    g=p.add_mutually_exclusive_group(required=True)
    g.add_argument('--fetch-pinned', action='store_true')
    g.add_argument('--source-dir', type=Path, help='directory with before.py and after.py, hashes verified before execution')
    p.add_argument('--output', type=Path)
    args=p.parse_args()
    modules={}
    for name,(commit,expected_hash) in SOURCES.items():
        url=f'https://raw.githubusercontent.com/ScopeBlind/agent-governance-testvectors/{commit}/{PATH}'
        if args.fetch_pinned:
            with urllib.request.urlopen(url,timeout=30) as response: data=response.read()
        else: data=(args.source_dir/f'{name}.py').read_bytes()
        if hashlib.sha256(data).hexdigest()!=expected_hash: raise ValueError(f'{name}: source hash mismatch; refused execution')
        module=types.ModuleType(f'pinned_{name}')
        exec(compile(data,url,'exec'),module.__dict__)
        modules[name]=module
    rows=[]
    for label,policy,tool,context,old_expected,new_expected in CASES:
        row={'case':label,'policy':policy,'tool':tool,'context':context}
        for name,m in modules.items():
            try:actual=m.evaluate(m.parse(policy),tool,context)
            except m.PolicyTypeError:actual='REFUSED'
            row[name]=actual
        row['matches_expected']=(row['before']==old_expected and row['after']==new_expected)
        rows.append(row)
        print(f"{label}: {row['before']} -> {row['after']}")
    result={'scope':'six cases against historical PR22 modules, not a current upstream audit or Cedar conformance test',
            'sources':{name:{'commit':x[0],'sha256':x[1],'path':PATH} for name,x in SOURCES.items()},'rows':rows}
    if args.output: args.output.write_text(json.dumps(result,indent=2)+'\n')
    if not all(r['matches_expected'] for r in rows): raise AssertionError('historical behavior differs from declared reproduction')
    print('6/6 before-and-after expectations reproduced; three restrictions change from allow to refusal; three controls unchanged.')

if __name__=='__main__':
    try: main()
    except Exception as e: raise SystemExit(f'REFUSED: {type(e).__name__}: {e}')
