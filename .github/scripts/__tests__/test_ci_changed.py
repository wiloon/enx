"""Exercise the selector through its dry-run command in an isolated repository."""
import pathlib
import shutil
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[3]


class SelectorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix=".ci-selector-test-", dir=ROOT)
        self.addCleanup(self.temp.cleanup)
        self.repo = pathlib.Path(self.temp.name)
        scripts = self.repo / ".github/scripts"
        scripts.mkdir(parents=True)
        shutil.copy(ROOT / ".github/scripts/ci-changed.sh", scripts)
        self.workflows = self.repo / ".github/workflows"
        self.workflows.mkdir()
        for name in ("enx-api-ci", "enx-ui-ci", "enx-chrome-ci", "copied-files"):
            (self.workflows / f"{name}.yml").write_text(
                "on:\n  pull_request:\n    paths:\n      - 'docs/**'\n"
            )
        self.git("init", "-q")
        self.git("add", ".")
        self.git("-c", "user.name=Test", "-c", "user.email=test@example.com",
                 "commit", "-qm", "fixture")

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.repo, check=True,
                              capture_output=True, text=True)

    def run_selector(self):
        return subprocess.run(["bash", ".github/scripts/ci-changed.sh", "HEAD"],
                              cwd=self.repo, capture_output=True, text=True)

    def test_rejects_unsupported_operators_and_escapes(self):
        for pattern in ("docs/v+.md", r"docs/v\+.md", "docs/v?.md", "docs/[ab].md"):
            with self.subTest(pattern=pattern):
                (self.workflows / "enx-api-ci.yml").write_text(
                    f"on:\n  pull_request:\n    paths:\n      - '{pattern}'\n"
                )
                result = self.run_selector()
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("unsupported path pattern", result.stderr)

    def test_top_level_permissions_ends_paths(self):
        (self.workflows / "enx-api-ci.yml").write_text(
            "on:\n  pull_request:\n    paths:\n      - 'docs/**'\n"
            "permissions:\n  contents: read\n"
        )
        result = self.run_selector()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("No ci tasks selected", result.stdout)


if __name__ == "__main__":
    unittest.main()
