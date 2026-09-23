"""Fire-and-forget work so Hub HTTP requests do not wait on Jobber / GHL."""

from __future__ import annotations

import logging
import threading

from django.db import close_old_connections, connection, transaction

logger = logging.getLogger(__name__)


def run_in_background(fn, *, name: str = "hub-side-effect") -> None:
    def _run() -> None:
        close_old_connections()
        try:
            fn()
        except Exception:
            logger.exception("Background task %s failed", name)
        finally:
            close_old_connections()

    def _start() -> None:
        threading.Thread(target=_run, name=name, daemon=True).start()

    if connection.in_atomic_block:
        transaction.on_commit(_start)
    else:
        _start()
