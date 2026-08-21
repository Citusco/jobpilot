"""Where the corpus lives on disk.

`corpus/raw/` is gitignored and large (326 MB across 20 sources). Keeping it
inside the working tree makes it collateral damage of ordinary git-worktree
lifecycle: `git worktree remove` refuses to discard a worktree with uncommitted
*tracked* changes, but gitignored data is invisible to that check, so a worktree
that has pushed all its commits looks disposable while still holding the only
copy. That is exactly how the corpus was lost on 2026-08-21 -- see the
2026-08-11 correction entries in docs/DECISIONS.md.

Setting JOBPILOT_CORPUS_RAW to a path outside any worktree removes the whole
failure mode, and has the side benefit that every worktree shares one copy
instead of each fetching its own.

Manifest `local_path` values stay written as "raw/<source>/..." regardless of
where the raw tree physically sits, so the manifests remain portable and no
existing record needs rewriting. resolve_local_path() is the only thing that
knows about the indirection.
"""
import os
from pathlib import Path, PureWindowsPath

ROOT = Path(__file__).resolve().parents[2]
CORPUS = ROOT / "corpus"

RAW_ENV_VAR = "JOBPILOT_CORPUS_RAW"


def raw_root() -> Path:
    """The directory holding one subdirectory per source id."""
    override = os.environ.get(RAW_ENV_VAR)
    if override:
        return Path(override).expanduser().resolve()
    return CORPUS / "raw"


def resolve_local_path(local_path: str) -> Path:
    """Maps a manifest local_path onto the filesystem.

    PureWindowsPath is used purely as a separator-agnostic parser -- it accepts
    both "/" and the Windows separator on every platform, which matters because
    manifests written on Windows contain the latter.
    """
    parts = PureWindowsPath(str(local_path)).parts
    if parts and parts[0] == "raw":
        return raw_root().joinpath(*parts[1:])
    return CORPUS.joinpath(*parts)
