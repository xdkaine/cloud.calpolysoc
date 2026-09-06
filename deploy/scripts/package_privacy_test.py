import unittest
from unittest.mock import patch
from package_privacy import cleanup_candidates, EXPOSED_TAG, require_private, REPOSITORY, cleanup


def version(identifier, tags):
    return {'id': identifier, 'metadata': {'container': {'tags': tags}}}


class PackagePrivacyTests(unittest.TestCase):
    def test_exact_incident_tag_only(self):
        self.assertEqual(cleanup_candidates([version(1, [EXPOSED_TAG]), version(2, ['sha-unrelated']), version(3, [])]), [1])

    def test_shared_tagged_version_refused(self):
        with self.assertRaises(ValueError):
            cleanup_candidates([version(1, [EXPOSED_TAG, 'latest'])])

    def test_missing_or_public_package_cannot_publish(self):
        for metadata in ({}, {'visibility': 'public'}, {'visibility': 'private', 'repository': {'full_name': 'other/repo'}}):
            with patch('package_privacy.api', return_value=metadata), self.assertRaises(RuntimeError):
                require_private('cloud-console')
        with patch('package_privacy.api', side_effect=RuntimeError('HTTP403')), self.assertRaises(RuntimeError):
            require_private('cloud-console')

    def test_private_linked_package_allowed(self):
        with patch('package_privacy.api', side_effect=[{'visibility': 'private', 'repository': {'full_name': REPOSITORY}}, {'private': True}]):
            require_private('cloud-console')

    def test_cleanup_rechecks_and_never_deletes_untagged_versions(self):
        calls = []
        def api(path, method='GET'):
            calls.append((path, method))
            if method == 'DELETE':
                return None
            if '/versions?' in path:
                return [version(1, [EXPOSED_TAG]), version(2, [])]
            return version(1, [EXPOSED_TAG])
        with patch('package_privacy.api', side_effect=api):
            cleanup()
        self.assertEqual([path for path, method in calls if method == 'DELETE'], ['/users/xdkaine/packages/container/cloud-console/versions/1', '/users/xdkaine/packages/container/cloud-ec2api/versions/1'])

    def test_cleanup_refuses_tag_change_before_delete(self):
        def api(path, method='GET'):
            self.assertNotEqual(method, 'DELETE')
            return [version(1, [EXPOSED_TAG])] if '/versions?' in path else version(1, ['other'])
        with patch('package_privacy.api', side_effect=api), self.assertRaises(RuntimeError):
            cleanup()

    def test_public_linked_package_allowed(self):
        with patch('package_privacy.api', side_effect=[{'visibility': 'public', 'repository': {'full_name': REPOSITORY}}, {'private': False}]):
            require_private('cloud-console')

    def test_private_source_public_package_denied(self):
        with patch('package_privacy.api', side_effect=[{'visibility': 'public', 'repository': {'full_name': REPOSITORY}}, {'private': True}]), self.assertRaises(RuntimeError):
            require_private('cloud-console')
