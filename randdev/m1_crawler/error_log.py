"""
Centralized error logging for the M1 crawler.
Writes structured entries to crawler_errors.log for later diagnosis.
"""
import json
import os
from datetime import datetime

ERROR_LOG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "crawler_errors.log")

__all__ = ["ERROR_LOG_FILE", "log_error"]


def log_error(
    kind: str,
    message: str,
    *,
    path: str | None = None,
    url: str | None = None,
    status_code: int | None = None,
    params: dict | None = None,
    vehicle_id: str | None = None,
    source: str | None = None,
    make: str | None = None,
    year: int | None = None,
    model: str | None = None,
    extra: dict | None = None,
):
    """
    Append an error entry to crawler_errors.log for later diagnosis.
    All fields are optional except kind and message.
    """
    entry = {
        "ts": datetime.utcnow().isoformat() + "Z",
        "kind": kind,
        "message": message,
    }
    if path:
        entry["path"] = path
    if url:
        entry["url"] = url
    if status_code is not None:
        entry["status_code"] = status_code
    if params:
        entry["params"] = params
    if vehicle_id:
        entry["vehicle_id"] = vehicle_id
    if source:
        entry["source"] = source
    if make:
        entry["make"] = make
    if year is not None:
        entry["year"] = year
    if model:
        entry["model"] = model
    if extra:
        entry["extra"] = extra

    line = json.dumps(entry, ensure_ascii=False) + "\n"
    try:
        with open(ERROR_LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line)
    except OSError:
        pass  # avoid crashing if log file is unavailable
