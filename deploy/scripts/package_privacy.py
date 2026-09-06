"""Fail-closed private-package gate and narrowly scoped incident cleanup."""
import json
import os
import sys
import urllib.error
import urllib.request

REPOSITORY = 'xdkaine/cloud.calpolysoc'
PACKAGES = ('cloud-console', 'cloud-ec2api')
EXPOSED_TAG = 'sha-5ad6e495be1533ce54cf26cfa4fa25562afbb8b6'


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


def cleanup_candidates(versions):
    result = []
    for version in versions:
        tags = version.get('metadata', {}).get('container', {}).get('tags', [])
        if EXPOSED_TAG not in tags:
            continue
        if tags != [EXPOSED_TAG]:
            raise ValueError('Matching version has additional tags; refusing broader deletion')
        identifier = version.get('id')
        if not isinstance(identifier, int) or isinstance(identifier, bool) or identifier <= 0:
            raise ValueError('Invalid version identifier')
        result.append(identifier)
    return result


def require_private(package):
    metadata = api(path(package))
    expected = 'private' if api('/repos/' + REPOSITORY).get('private') else 'public'
    if metadata.get('visibility') != expected:
        raise RuntimeError(f'Refusing publication: {package} visibility does not match source repository')
    if metadata.get('repository', {}).get('full_name') != REPOSITORY:
        raise RuntimeError(f'Refusing publication: {package} is not linked to expected repository')
    print(package + ': visibility matches source repository and linkage confirmed')


def cleanup():
    plan = []
    # Validate the complete limited plan before the first delete.
    for package in PACKAGES:
        versions = []
        page = 1
        while True:
            batch = api(path(package) + f'/versions?per_page=100&page={page}')
            versions.extend(batch)
            if len(batch) < 100:
                break
            page += 1
        plan.extend((package, identifier) for identifier in cleanup_candidates(versions))
    for package, identifier in plan:
        # Re-read immediately before deletion; deny if tags changed since planning.
        current = api(path(package) + f'/versions/{identifier}')
        if cleanup_candidates([current]) != [identifier]:
            raise RuntimeError('Version changed since cleanup planning')
        api(path(package) + f'/versions/{identifier}', 'DELETE')
        print(f'Deleted only approved incident version {package}/{identifier}')
    print(f'Cleanup completed for {len(plan)} approved tagged versions; other versions untouched')
    print('This removes tagged index versions only. Untagged OCI child manifests may remain addressable by digest; complete retraction is NOT established.')


def main():
    if os.environ.get('GITHUB_REPOSITORY') != REPOSITORY:
        raise RuntimeError('Unexpected repository')
    if sys.argv[1:] == ['cleanup']:
        cleanup()
    elif len(sys.argv) == 3 and sys.argv[1] == 'check':
        require_private(sys.argv[2])
    else:
        raise ValueError('Expected check PACKAGE or cleanup')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
