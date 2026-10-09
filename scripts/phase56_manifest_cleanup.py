from pathlib import Path
import json
import subprocess

base_sha = '997c3cf7b1e2b192620d7bd116aca9f7d6c71404'
manifest = Path('data/phase52-major-conference-expansion.json')
events = json.loads(manifest.read_text())
wpc = [e for e in events if e.get('title') == '25th WPC Energy Congress 2026']
if len(wpc) != 1:
    raise SystemExit(f'Expected exactly one WPC event in temporary manifest, found {len(wpc)}')

# Restore the pre-Phase-56 manifest exactly so this phase does not reformat unrelated records.
subprocess.run(['git', 'fetch', 'origin', base_sha, '--depth=1'], check=True)
original = subprocess.check_output(['git', 'show', f'{base_sha}:data/phase52-major-conference-expansion.json'])
manifest.write_bytes(original)

phase56_manifest = Path('data/phase56-global-major-conferences.json')
phase56_manifest.write_text(json.dumps(wpc, indent=2, ensure_ascii=False) + '\n')

sync_path = Path('scripts/syncPhase52MajorConferences.mjs')
sync = sync_path.read_text()
old = """const events = JSON.parse(\n  fs.readFileSync(path.join(process.cwd(), 'data', 'phase52-major-conference-expansion.json'), 'utf8')\n);"""
new = """const manifestFiles = [\n  'phase52-major-conference-expansion.json',\n  'phase56-global-major-conferences.json',\n];\nconst events = manifestFiles.flatMap((file) => {\n  const filePath = path.join(process.cwd(), 'data', file);\n  return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : [];\n});"""
if old not in sync:
    raise SystemExit('syncPhase52MajorConferences manifest loader anchor not found')
sync_path.write_text(sync.replace(old, new, 1))

print('Phase 56 manifest cleanup applied')
