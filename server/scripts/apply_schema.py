"""Apply app/sql/schema.sql to the configured DATABASE_URL.

Uses asyncpg (already a runtime dep) so no psql / libpq install is required.
The schema is idempotent (`create ... if not exists`), safe to re-run.

    uv run python scripts/apply_schema.py

Reads DATABASE_URL from:
  1. `server/.env` (if present)
  2. the process environment (override)
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import asyncpg

ROOT = Path(__file__).resolve().parent.parent
SCHEMA_PATH = ROOT / "app" / "sql" / "schema.sql"
ENV_PATH = ROOT / ".env"


def _load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


async def main() -> int:
    _load_env_file(ENV_PATH)
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("ERROR: DATABASE_URL not set (in server/.env or environment).")
        return 2

    if not SCHEMA_PATH.exists():
        print(f"ERROR: schema file missing at {SCHEMA_PATH}")
        return 2

    ddl = SCHEMA_PATH.read_text()
    # asyncpg disallows prepared statements on multi-statement DDL → use
    # a raw simple-query execute, which Postgres handles as a single batch.
    conn = await asyncpg.connect(url)
    try:
        await conn.execute(ddl)
        rows = await conn.fetch(
            """
            select table_name
            from information_schema.tables
            where table_schema = 'public'
              and table_name in ('sessions','transcript_segments',
                                 'suggestion_batches','suggestions','chat_messages')
            order by table_name
            """
        )
    finally:
        await conn.close()

    found = [r["table_name"] for r in rows]
    expected = [
        "chat_messages",
        "sessions",
        "suggestion_batches",
        "suggestions",
        "transcript_segments",
    ]
    missing = [t for t in expected if t not in found]

    print(f"applied schema: {SCHEMA_PATH.relative_to(ROOT)}")
    print(f"tables present: {', '.join(found) if found else '(none)'}")
    if missing:
        print(f"WARNING: missing tables: {', '.join(missing)}")
        return 1
    print("ok.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
