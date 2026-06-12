"""Typed errors the orchestrator can handle."""

from __future__ import annotations


class EngineError(Exception):
    """Base class for all engine errors."""


class IrreversibleInSpeculationError(EngineError):
    """Raised when an IRREVERSIBLE tool is invoked inside a speculative branch.

    The orchestrator catches this to decide whether to commit the branch first
    (promoting it to trunk) or to abandon the action. The branch survives.
    """


class UnknownBranchError(EngineError):
    """Raised when an operation references a branch_id the engine does not know."""


class UnknownToolError(EngineError):
    """Raised when execute() is called with a tool name that was never registered."""


class DeadBranchError(EngineError):
    """Raised when an operation targets a branch that has been squashed or committed away."""
