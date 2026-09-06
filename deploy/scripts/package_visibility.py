"""Require registry package visibility to match its source repository."""
import json
import os
import sys
import urllib.error
import urllib.request

REPOSITORY = 'xdkaine/cloud.calpolysoc'
PACKAGES = ('cloud-console', 'cloud-ec2api')


def api(path, method='GET'):
    request = urllib.request.Request('https://api.github.com' + path, method=method,
        headers={'Authorization': 'Bearer ' + os.environ['GH_TOKEN'],
                 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return None if response.status == 204 else json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f'Package API {method} failed with HTTP {error.code}; no response or credentials logged') from None


def path(package):
    if package not in PACKAGES:
        raise ValueError('Package outside approved scope')
    return '/users/xdkaine/packages/container/' + package


def require_matching_visibility(package):
    metadata = api(path(package))
    expected = 'private' if api('/repos/' + REPOSITORY).get('private') else 'public'
    if metadata.get('visibility') != expected:
        raise RuntimeError(f'Refusing publication: {package} visibility does not match source repository')
    if metadata.get('repository', {}).get('full_name') != REPOSITORY:
        raise RuntimeError(f'Refusing publication: {package} is not linked to expected repository')
    print(package + ': visibility matches source repository and linkage confirmed')


def main():
    if os.environ.get('GITHUB_REPOSITORY') != REPOSITORY:
        raise RuntimeError('Unexpected repository')
    if len(sys.argv) == 3 and sys.argv[1] == 'check':
        require_matching_visibility(sys.argv[2])
    else:
        raise ValueError('Expected check PACKAGE')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
