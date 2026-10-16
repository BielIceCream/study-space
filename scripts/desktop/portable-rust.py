"""Download verified Rust build tools into this project's cache; no system install."""
import hashlib
import pathlib
import shutil
import tarfile
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
CACHE = ROOT / '.cache' / 'rust'
TOOLCHAIN = CACHE / 'toolchain'
VERSION = '1.99.0'
TARGET = 'x86_64-pc-windows-msvc'
COMPONENTS = ['cargo', 'rustc', 'rust-std']

def download(component):
    name = f'{component}-{VERSION}-{TARGET}.tar.xz'
    url = f'https://static.rust-lang.org/dist/{name}'
    archive = CACHE / name
    expected = urllib.request.urlopen(url + '.sha256').read().decode().split()[0]
    if not archive.exists():
        print(f'Baixando {component} {VERSION}...', flush=True)
        with urllib.request.urlopen(url) as source, archive.open('wb') as target:
            shutil.copyfileobj(source, target)
    with archive.open('rb') as source:
        actual = hashlib.file_digest(source, 'sha256').hexdigest()
    if actual != expected:
        raise ValueError(f'SHA256 inválido: {component}. O arquivo não será executado.')
    print(f'Extraindo {component} verificado...', flush=True)
    with tarfile.open(archive, mode='r:xz') as package:
        for member in package:
            parts = pathlib.PurePosixPath(member.name).parts
            # Official component tarballs have package/component/<installation files>.
            if len(parts) < 3 or not (parts[1] == component or parts[1].startswith(component + '-')):
                continue
            destination = (TOOLCHAIN / pathlib.Path(*parts[2:])).resolve()
            if not destination.is_relative_to(TOOLCHAIN.resolve()):
                raise ValueError('Caminho inválido no pacote Rust.')
            if member.isdir():
                destination.mkdir(parents=True, exist_ok=True)
            elif member.isfile():
                destination.parent.mkdir(parents=True, exist_ok=True)
                with package.extractfile(member) as source, destination.open('wb') as target:
                    shutil.copyfileobj(source, target)
            else:
                raise ValueError('Links não são aceitos nos pacotes de build.')

if __name__ == '__main__':
    CACHE.mkdir(parents=True, exist_ok=True)
    TOOLCHAIN.mkdir(parents=True, exist_ok=True)
    for item in COMPONENTS:
        download(item)
    print(f'Ferramentas locais em {TOOLCHAIN}', flush=True)
