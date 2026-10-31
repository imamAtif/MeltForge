"""
Git Service - Handles version control, branch detection, diffs, commits, and rollbacks
for the underlying Meltano project.
"""

import asyncio
from pathlib import Path
from typing import Dict, Any, List, Optional


class GitService:
    def __init__(self, project_root: Path):
        self.project_root = project_root

    async def _run_git(self, *args: str) -> tuple[bool, str]:
        try:
            proc = await asyncio.create_subprocess_exec(
                "git", *args,
                cwd=str(self.project_root),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await proc.communicate()
            success = proc.returncode == 0
            output = (stdout.decode() + stderr.decode()).strip()
            return success, output
        except Exception as e:
            return False, str(e)

    async def get_status(self) -> Dict[str, Any]:
        """Returns repo status: branch, modified files, commit count, is_repo."""
        is_repo, _ = await self._run_git("rev-parse", "--is-inside-work-tree")
        if not is_repo:
            return {
                "is_git": False,
                "branch": "none",
                "clean": True,
                "modified_files": [],
                "uncommitted_count": 0,
                "recent_commits": []
            }

        _, branch = await self._run_git("branch", "--show-current")
        branch_name = branch.strip() or "detached"

        _, status_out = await self._run_git("status", "--porcelain")
        modified = []
        for line in status_out.splitlines():
            if line.strip():
                status_code = line[:2].strip()
                file_path = line[3:].strip()
                modified.append({"status": status_code, "file": file_path})

        _, log_out = await self._run_git("log", "-n", "5", "--pretty=format:%h|%s|%cr|%an")
        recent_commits = []
        for line in log_out.splitlines():
            if line.strip():
                parts = line.split("|")
                if len(parts) >= 4:
                    recent_commits.append({
                        "hash": parts[0],
                        "message": parts[1],
                        "time": parts[2],
                        "author": parts[3]
                    })

        return {
            "is_git": True,
            "branch": branch_name,
            "clean": len(modified) == 0,
            "modified_files": modified,
            "uncommitted_count": len(modified),
            "recent_commits": recent_commits
        }

    async def commit_changes(self, message: str) -> Dict[str, Any]:
        """Stages meltano.yml and commits with human-readable message."""
        await self._run_git("add", "meltano.yml")
        success, out = await self._run_git("commit", "-m", message)
        return {"success": success, "message": out}

    async def revert_changes(self) -> Dict[str, Any]:
        """Discards uncommitted changes to meltano.yml."""
        success, out = await self._run_git("checkout", "--", "meltano.yml")
        return {"success": success, "message": out or "meltano.yml reverted successfully."}

    async def pull(self) -> Dict[str, Any]:
        """Runs git pull to fetch remote updates."""
        success, out = await self._run_git("pull")
        return {"success": success, "message": out}
