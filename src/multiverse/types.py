"""Shared types for the Multiverse engine."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class EffectClass(str, Enum):
    """How a registered tool interacts with world state.

    READ                — pure read; passes through, result recorded.
    SPECULATABLE_WRITE  — mutates state; applied only to the branch sandbox.
    IRREVERSIBLE        — real-world side effect; refused in speculative branches,
                          allowed only on the committed trunk.
    """

    READ = "READ"
    SPECULATABLE_WRITE = "SPECULATABLE_WRITE"
    IRREVERSIBLE = "IRREVERSIBLE"


@dataclass
class ToolResult:
    """Typed result of an engine.execute() call."""

    ok: bool
    value: Any = None
    error: str | None = None
    effect_class: EffectClass | None = None
    latency_ms: float = 0.0
    staged: bool = False  # True if an IRREVERSIBLE effect was staged rather than performed
    meta: dict[str, Any] = field(default_factory=dict)
