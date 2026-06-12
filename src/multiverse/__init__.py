"""Multiverse — a speculative execution harness for AI agents.

Public surface:
    Engine            — the tool-call proxy + fork/commit/replay engine
    ToolResult        — typed result returned from execute()
    EffectClass       — READ | SPECULATABLE_WRITE | IRREVERSIBLE
    IrreversibleInSpeculationError — raised when an IRREVERSIBLE tool runs in a speculative branch
"""

from .engine import Engine
from .orchestrator import Action, Orchestrator, ScriptedRunner, Task
from .types import EffectClass, ToolResult
from .errors import IrreversibleInSpeculationError

__all__ = [
    "Engine",
    "Action",
    "Orchestrator",
    "ScriptedRunner",
    "Task",
    "ToolResult",
    "EffectClass",
    "IrreversibleInSpeculationError",
]

__version__ = "0.1.0"
