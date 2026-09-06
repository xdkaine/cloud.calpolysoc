import unittest
from unittest.mock import patch
from package_visibility import require_matching_visibility, REPOSITORY

class VisibilityTests(unittest.TestCase):
    def check(self, private, visibility, repository=REPOSITORY):
        with patch('package_visibility.api', side_effect=[{'visibility':visibility, 'repository':{'full_name':repository}}, {'private':private}]):
            require_matching_visibility('cloud-console')
    def test_matching_public(self): self.check(False,'public')
    def test_matching_private(self): self.check(True,'private')
    def test_mismatch_denied(self):
        for private,visibility in [(True,'public'),(False,'private')]:
            with self.assertRaises(RuntimeError): self.check(private,visibility)
    def test_other_repository_denied(self):
        with self.assertRaises(RuntimeError): self.check(False,'public','other/repo')
    def test_api_failure_denied(self):
        with patch('package_visibility.api', side_effect=RuntimeError('HTTP403')),self.assertRaises(RuntimeError):
            require_matching_visibility('cloud-console')
