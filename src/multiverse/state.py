"""Branch sandboxes, fork, and atomic commit for the Multiverse engine."""

from __future__ import annotations

import shutil
import sqlite3
import threading
from dataclasses import dataclass
from pathlib import Path

from .errors import DeadBranchError, EngineError, UnknownBranchError


@dataclass
class BranchState:
    """Per-branch metadata held in the in-memory registry.

    Attributes:
        branch_id: Dotted-lineage identifier (e.g. ``"b_root.2.1"``).
        parent_id: Immediate ancestor's branch_id, or ``None`` for trunk.
        status: One of ``"trunk"``, ``"live"``, ``"dead"``, ``"committed"``.
        next_child: Monotonic counter for generating the next child suffix.
        step_counter: Monotonic counter for the next step index to issue.
    """

    branch_id: str
    parent_id: str | None
    status: str
    next_child: int = 1
    step_counter: int = 0


class BranchManager:
    """Manages branch sandboxes, forking, and atomic commit for the Multiverse engine.

    Thread-safe: a single ``threading.RLock`` guards all registry mutations
    and counter increments.  File I/O (copytree / move / rmtree) is performed
    outside the lock where possible so that concurrent branches are not
    unnecessarily serialised.

    Directory layout under *root*::

        root/
          trunk/workspace/          real-world workspace (b_root resolves here)
          trunk/state.db            real-world SQLite DB
          trunk_initial/            frozen copy of trunk at init (for replay)
            workspace/
            state.db
          branches/<id>/workspace/  live branch sandbox
          branches/<id>/state.db
          branches/<id>/initial/    frozen copy at fork (survives squash / commit)
            workspace/
            state.db
          replays/                  engine.py puts reconstructed sandboxes here
    """

    TRUNK_ID = "b_root"

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def __init__(self, root: Path) -> None:
        """Create the on-disk layout, an empty trunk ``state.db``, and register
        ``"b_root"`` with status ``"trunk"`` and no parent."""
        self._root = root
        self._lock = threading.RLock()
        self._registry: dict[str, BranchState] = {}

        # -- directory scaffolding -----------------------------------------
        root.mkdir(parents=True, exist_ok=True)
        (root / "trunk" / "workspace").mkdir(parents=True, exist_ok=True)
        (root / "branches").mkdir(exist_ok=True)
        (root / "replays").mkdir(exist_ok=True)

        # -- empty trunk database ------------------------------------------
        db_path = root / "trunk" / "state.db"
        if not db_path.exists():
            sqlite3.connect(str(db_path)).close()

        # -- register the root of the tree ---------------------------------
        self._registry[self.TRUNK_ID] = BranchState(
            branch_id=self.TRUNK_ID,
            parent_id=None,
            status="trunk",
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _check_known(self, branch_id: str) -> None:
        """Raise ``UnknownBranchError`` if *branch_id* is not in the registry."""
        if branch_id not in self._registry:
            raise UnknownBranchError(branch_id)

    def _check_not_dead(self, branch_id: str) -> None:
        """Raise ``UnknownBranchError`` or ``DeadBranchError`` as appropriate."""
        self._check_known(branch_id)
        if self._registry[branch_id].status == "dead":
            raise DeadBranchError(branch_id)

    def _resolve_workspace(self, branch_id: str) -> Path:
        """Return the workspace path for a known, non-dead branch."""
        state = self._registry[branch_id]
        if state.branch_id == self.TRUNK_ID or state.status == "committed":
            return self._root / "trunk" / "workspace"
        return self._root / "branches" / branch_id / "workspace"

    def _resolve_db(self, branch_id: str) -> Path:
        """Return the state.db path for a known, non-dead branch."""
        state = self._registry[branch_id]
        if state.branch_id == self.TRUNK_ID or state.status == "committed":
            return self._root / "trunk" / "state.db"
        return self._root / "branches" / branch_id / "state.db"

    def _seed_child_sandbox(
        self, child_id: str, src_workspace: Path, src_db: Path
    ) -> None:
        """Copy *src_workspace* and *src_db* into the child's live sandbox AND
        its frozen ``initial/`` snapshot."""
        child_dir = self._root / "branches" / child_id
        child_dir.mkdir(parents=True, exist_ok=True)

        tgt_ws = child_dir / "workspace"
        tgt_db = child_dir / "state.db"
        init_dir = child_dir / "initial"
        init_ws = init_dir / "workspace"
        init_db = init_dir / "state.db"

        init_dir.mkdir(exist_ok=True)

        shutil.copytree(src_workspace, tgt_ws)
        shutil.copy2(src_db, tgt_db)
        shutil.copytree(src_workspace, init_ws)
        shutil.copy2(src_db, init_db)

    # ------------------------------------------------------------------
    # Snapshot
    # ------------------------------------------------------------------

    def snapshot_trunk_initial(self) -> None:
        """Copy ``trunk/workspace`` + ``trunk/state.db`` into
        ``trunk_initial/`` so the initial world state can be replayed later."""
        trunk_initial = self._root / "trunk_initial"
        if trunk_initial.exists():
            shutil.rmtree(trunk_initial)
        trunk_initial.mkdir()

        trunk_ws = self._root / "trunk" / "workspace"
        trunk_db = self._root / "trunk" / "state.db"

        shutil.copytree(trunk_ws, trunk_initial / "workspace")
        shutil.copy2(trunk_db, trunk_initial / "state.db")

    # ------------------------------------------------------------------
    # Fork
    # ------------------------------------------------------------------

    def fork(self, parent_id: str, n: int = 1) -> list[str]:
        """Fork *n* children from *parent_id*.

        The parent must exist and not be dead (``UnknownBranchError`` /
        ``DeadBranchError``).  Each child receives a copy of the parent's
        **current** workspace + DB, and a frozen ``initial/`` snapshot is
        saved alongside so that time-travel forks remain possible later.

        Child IDs are generated under the global lock as consecutive suffixes
        of the parent's ``next_child`` counter.

        Returns the list of newly-created child branch IDs, each with status
        ``"live"``.
        """
        self._check_known(parent_id)

        with self._lock:
            parent_state = self._registry[parent_id]
            if parent_state.status == "dead":
                raise DeadBranchError(parent_id)

            # Resolve source paths *while we hold the lock* so the parent's
            # status cannot change underneath us mid-resolution.
            src_workspace = self._resolve_workspace(parent_id)
            src_db = self._resolve_db(parent_id)

            start = parent_state.next_child
            child_ids = [f"{parent_id}.{i}" for i in range(start, start + n)]
            parent_state.next_child += n

            for cid in child_ids:
                self._registry[cid] = BranchState(
                    branch_id=cid,
                    parent_id=parent_id,
                    status="live",
                )

        # File operations outside the lock (I/O heavy, blocks only itself).
        for cid in child_ids:
            self._seed_child_sandbox(cid, src_workspace, src_db)

        return child_ids

    def create_branch_from_state(
        self, parent_id: str, src_workspace: Path, src_db: Path, n: int = 1
    ) -> list[str]:
        """Like :meth:`fork`, but seeds the children from the given *src_workspace*
        and *src_db* paths instead of resolving the parent's live sandbox.

        The *parent_id* may reference **any** known branch — including dead or
        committed ones — enabling time-travel forks (``fork_at``).
        """
        self._check_known(parent_id)

        with self._lock:
            parent_state = self._registry[parent_id]
            start = parent_state.next_child
            child_ids = [f"{parent_id}.{i}" for i in range(start, start + n)]
            parent_state.next_child += n

            for cid in child_ids:
                self._registry[cid] = BranchState(
                    branch_id=cid,
                    parent_id=parent_id,
                    status="live",
                )

        for cid in child_ids:
            self._seed_child_sandbox(cid, src_workspace, src_db)

        return child_ids

    # ------------------------------------------------------------------
    # Commit / squash
    # ------------------------------------------------------------------

    def commit(self, branch_id: str) -> None:
        """Atomically promote *branch_id* to be the new trunk.

        The branch must be ``"live"`` and speculative (i.e. not trunk itself).
        Raises:

        * ``UnknownBranchError`` — unknown *branch_id*.
        * ``DeadBranchError`` — branch is already dead.
        * ``EngineError`` — branch is trunk or already committed.

        The entire operation is guarded by the global lock.  A rename-swap
        makes the transition atomic from the reader's perspective:

        1. Build ``.trunk_new/`` containing the branch's workspace + state.db
           (moved, not copied).
        2. ``trunk → .trunk_old`` ; ``.trunk_new → trunk``.
        3. Remove ``.trunk_old``.
        4. Clean leftover working directories of the committed branch,
           but **keep** ``branches/<id>/initial/``.
        5. Mark the branch ``"committed"`` (it now resolves to trunk paths).
        """
        with self._lock:
            self._check_not_dead(branch_id)
            state = self._registry[branch_id]

            if state.branch_id == self.TRUNK_ID:
                raise EngineError("Cannot commit trunk itself")
            if state.status != "live":
                raise EngineError(
                    f"Cannot commit {branch_id!r}: status is {state.status!r}"
                )

            branch_dir = self._root / "branches" / branch_id
            src_ws = branch_dir / "workspace"
            src_db = branch_dir / "state.db"

            trunk_new = self._root / ".trunk_new"
            trunk = self._root / "trunk"
            trunk_old = self._root / ".trunk_old"

            # Remove stale temp dirs from any previous interrupted commit.
            if trunk_new.exists():
                shutil.rmtree(trunk_new)
            if trunk_old.exists():
                shutil.rmtree(trunk_old)

            trunk_new.mkdir()

            # Move branch content into .trunk_new
            shutil.move(str(src_ws), str(trunk_new / "workspace"))
            shutil.move(str(src_db), str(trunk_new / "state.db"))

            # Atomic rename-swap
            trunk.rename(trunk_old)
            trunk_new.rename(trunk)

            # Remove old trunk
            if trunk_old.exists():
                shutil.rmtree(trunk_old)

            # Clean leftover branch working dirs — keep initial/ intact.
            ws_remnant = branch_dir / "workspace"
            db_remnant = branch_dir / "state.db"
            if ws_remnant.exists():
                shutil.rmtree(ws_remnant, ignore_errors=True)
            if db_remnant.exists():
                db_remnant.unlink(missing_ok=True)

            state.status = "committed"

    def squash(self, branch_id: str) -> bool:
        """Delete the live sandbox of *branch_id* and mark it dead.

        Raises ``EngineError`` for trunk / committed branches.  Returns
        ``False`` (no-op) if the branch is already dead.  The frozen
        ``initial/`` directory is always preserved so that time-travel forks
        remain possible.
        """
        with self._lock:
            self._check_known(branch_id)
            state = self._registry[branch_id]

            if state.status in ("trunk", "committed"):
                raise EngineError(
                    f"Cannot squash {branch_id!r}: status is {state.status!r}"
                )
            if state.status == "dead":
                return False

            state.status = "dead"

        branch_dir = self._root / "branches" / branch_id
        ws = branch_dir / "workspace"
        db = branch_dir / "state.db"
        staged = branch_dir / "staged_http.jsonl"

        if ws.exists():
            shutil.rmtree(ws)
        if db.exists():
            db.unlink()
        if staged.exists():
            staged.unlink()

        return True

    # ------------------------------------------------------------------
    # Path resolution
    # ------------------------------------------------------------------

    def get_workspace(self, branch_id: str) -> Path:
        """Return the filesystem workspace directory for *branch_id*.

        Trunk and committed branches resolve to ``trunk/workspace``.
        Live branches resolve to ``branches/<id>/workspace``.

        Raises ``UnknownBranchError`` or ``DeadBranchError``.
        """
        with self._lock:
            self._check_not_dead(branch_id)
            return self._resolve_workspace(branch_id)

    def get_db_path(self, branch_id: str) -> Path:
        """Return the SQLite database path for *branch_id*.

        Trunk and committed branches resolve to ``trunk/state.db``.
        Live branches resolve to ``branches/<id>/state.db``.

        Raises ``UnknownBranchError`` or ``DeadBranchError``.
        """
        with self._lock:
            self._check_not_dead(branch_id)
            return self._resolve_db(branch_id)

    def branch_dir(self, branch_id: str) -> Path:
        """Return ``root/branches/<id>`` for any known, non-trunk branch (even dead).

        For ``b_root`` this returns ``root/branches/b_root`` (the directory
        does not necessarily exist — trunk lives under ``root/trunk``).
        """
        self._check_known(branch_id)
        return self._root / "branches" / branch_id

    def initial_dir(self, branch_id: str) -> Path:
        """Return the frozen initial-snapshot directory for *branch_id*.

        For ``b_root`` this is ``root/trunk_initial``; for every other branch
        it is ``root/branches/<id>/initial``.
        """
        self._check_known(branch_id)
        if branch_id == self.TRUNK_ID:
            return self._root / "trunk_initial"
        return self._root / "branches" / branch_id / "initial"

    # ------------------------------------------------------------------
    # Introspection
    # ------------------------------------------------------------------

    def parent_of(self, branch_id: str) -> str | None:
        """Return the immediate parent branch ID, or ``None`` for trunk."""
        self._check_known(branch_id)
        return self._registry[branch_id].parent_id

    def status(self, branch_id: str) -> str:
        """Return the status string for *branch_id*.

        Raises ``UnknownBranchError`` if the branch is not known.
        """
        self._check_known(branch_id)
        return self._registry[branch_id].status

    def is_speculative(self, branch_id: str) -> bool:
        """Return ``True`` if *branch_id* is live **and** not trunk."""
        self._check_known(branch_id)
        state = self._registry[branch_id]
        return state.status == "live" and state.branch_id != self.TRUNK_ID

    def live_branches(self) -> list[str]:
        """Return IDs of every speculative live branch (excludes trunk)."""
        with self._lock:
            return [
                bid
                for bid, st in self._registry.items()
                if st.status == "live" and st.branch_id != self.TRUNK_ID
            ]

    def assert_executable(self, branch_id: str) -> None:
        """Raise ``UnknownBranchError`` or ``DeadBranchError`` if the branch
        is not in a state that permits tool execution."""
        self._check_not_dead(branch_id)

    # ------------------------------------------------------------------
    # Step counters (thread-safe)
    # ------------------------------------------------------------------

    def next_step(self, branch_id: str) -> int:
        """Thread-safe post-increment: return the next step index and advance
        the counter.  The first call on a given branch returns ``0``.

        Raises ``UnknownBranchError`` or ``DeadBranchError``.
        """
        with self._lock:
            self._check_not_dead(branch_id)
            state = self._registry[branch_id]
            step = state.step_counter
            state.step_counter += 1
            return step

    def current_step(self, branch_id: str) -> int:
        """Return the last step index issued for *branch_id*, or ``-1`` if no
        step has been issued yet."""
        with self._lock:
            self._check_known(branch_id)
            return self._registry[branch_id].step_counter - 1
