"""
Git Router - Git status, branch, committing meltano.yml, and rollbacks.
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional
from meltforge.services.git_service import GitService

router = APIRouter(prefix="/api/git", tags=["git"])


class CommitRequest(BaseModel):
    message: str


def get_git_service() -> GitService:
    from meltforge.server import git_service
    return git_service


@router.get("/status")
async def get_git_status(git_svc: GitService = Depends(get_git_service)):
    """Returns repository branch, uncommitted diffs, and recent commits."""
    status = await git_svc.get_status()
    return status


@router.post("/commit")
async def commit_changes(req: CommitRequest, git_svc: GitService = Depends(get_git_service)):
    """Commits modified meltano.yml to Git."""
    res = await git_svc.commit_changes(req.message)
    return res


@router.post("/revert")
async def revert_changes(git_svc: GitService = Depends(get_git_service)):
    """Reverts any uncommitted changes to meltano.yml."""
    res = await git_svc.revert_changes()
    return res


@router.post("/pull")
async def pull_repo(git_svc: GitService = Depends(get_git_service)):
    """Pulls latest updates from remote repository."""
    res = await git_svc.pull()
    return res
