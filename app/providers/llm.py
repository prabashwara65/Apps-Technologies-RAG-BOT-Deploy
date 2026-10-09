"""Vendor-neutral language model contract.

The contract describes only what the grounded answer service needs: an
identified model and one synchronous completion from a system and user prompt.
It carries no transport, credential, streaming, tool-calling, or conversation
concept, so a hosted, local, or remote implementation can satisfy it without
leaking vendor concerns into services.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable


@dataclass(frozen=True, slots=True)
class TokenUsage:
    """Provider-reported token counts for one generated completion."""

    prompt_tokens: int | None
    output_tokens: int | None
    total_tokens: int | None


@runtime_checkable
class LLMProvider(Protocol):
    """Minimal contract every language model backend must satisfy."""

    @property
    def model_name(self) -> str:
        """Stable model identifier recorded with generated answers."""
        ...

    @property
    def model_version(self) -> str:
        """Stable version identifier for the model that produced the text."""
        ...

    def generate(self, *, system_prompt: str, user_prompt: str) -> str:
        """Return one completion for the supplied prompts."""
        ...


@runtime_checkable
class LLMUsageProvider(Protocol):
    """Optional provider capability for request-scoped generation token usage."""

    @property
    def token_usage(self) -> TokenUsage | None:
        """Return usage metadata for the most recent completion in this context."""
        ...

    def reset_token_usage(self) -> None:
        """Clear usage metadata before starting a new request."""
        ...
