"""Use Dawn's DEPS pins without installing Chromium's depot_tools or toolchains."""
import importlib.util
import pathlib
import sys

root = pathlib.Path(sys.argv[1]).resolve()
spec = importlib.util.spec_from_file_location('dawn_fetch', root / 'tools/fetch_dawn_dependencies.py')
fetch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fetch)
deps = [
    'third_party/abseil-cpp', 'third_party/jinja2', 'third_party/markupsafe',
    'third_party/EGL-Registry/src', 'third_party/OpenGL-Registry/src',
    'third_party/glslang/src', 'third_party/spirv-headers/src',
    'third_party/spirv-tools/src', 'third_party/vulkan-headers/src',
    'third_party/vulkan-utility-libraries/src', 'third_party/webgpu-headers/src',
    'third_party/node-addon-api', 'third_party/node-api-headers', 'third_party/gpuweb',
]
if sys.platform == 'win32':
    deps += ['third_party/directx-shader-compiler/src', 'third_party/directx-headers/src']
# Read the upstream dependency pins, but check every subprocess result.
import subprocess
from concurrent.futures import ThreadPoolExecutor
scope = {}
exec((root / 'DEPS').read_text(), {'Var': fetch.Var, 'Str': str}, scope)
def download(dep):
    entry = scope['deps'].get(dep)
    if not entry:
        raise RuntimeError(f'Dawn no longer declares the required dependency {dep}')
    url, pin = entry['url'].format(**scope['vars']).rsplit('@', 1)
    folder = root / dep
    folder.mkdir(parents=True, exist_ok=True)
    def git(*args, capture=False):
        return subprocess.run(['git', '-C', str(folder), *args], check=True,
                              text=True, capture_output=capture)
    if not (folder / '.git').exists():
        git('init', '-q')
    current = subprocess.run(['git', '-C', str(folder), 'rev-parse', 'HEAD'], capture_output=True, text=True)
    if current.returncode == 0 and current.stdout.strip() == pin:
        return
    print(f'Fetching {dep} at {pin}', flush=True)
    git('fetch', '--depth', '1', url, pin)
    git('checkout', '--detach', pin)
    actual = subprocess.check_output(['git', '-C', str(root / dep), 'rev-parse', 'HEAD'], text=True).strip()
    if actual != pin:
        raise RuntimeError(f'{dep}: expected {pin}, got {actual}')
with ThreadPoolExecutor(max_workers=4) as pool:
    list(pool.map(download, deps))
