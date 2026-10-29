"""Restore a SQL snapshot into a new, private sibling file. Never connects remotely."""
import hashlib
import json
import os
import sqlite3
import sys
from pathlib import Path


def restore(source, target, manifest):
    source, target, manifest = (Path(p).resolve() for p in (source, target, manifest))
    if target.parent != source.parent or manifest.parent != source.parent:
        raise ValueError("Recovery files must share the private snapshot directory")
    if target.exists() or manifest.exists():
        raise ValueError("Recovery output already exists")
    with source.open("rb") as f:
        f.seek(max(0, source.stat().st_size - 4096))
        if not f.read().decode("utf-8").rstrip().endswith("COMMIT;"):
            raise ValueError("Incomplete SQL export")
    os.umask(0o077)
    fd = os.open(target, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    db = sqlite3.connect(target)
    try:
        db.execute("PRAGMA cache_size=-8192")
        statement, statements = "", 0
        with source.open(encoding="utf-8") as f:
            for line in f:
                statement += line
                if sqlite3.complete_statement(statement):
                    db.execute(statement)
                    statement = ""
                    statements += 1
        if statement.strip() or db.in_transaction:
            raise ValueError("SQL export was not completely committed")
        if db.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise ValueError("Restored database failed integrity checking")
        if db.execute("PRAGMA foreign_key_check").fetchall():
            raise ValueError("Restored database has foreign-key violations")
        tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        counts = {name: db.execute('SELECT count(*) FROM "' + name.replace('"', '""') + '"').fetchone()[0] for name in tables}
        required = ["users", "messages", "conversations", "submissions", "created_conferences", "billing_provider_events"]
        if any(name not in counts for name in required):
            raise ValueError("Core application tables are missing")
        def digest(file):
            value = hashlib.sha256()
            with file.open("rb") as f:
                for block in iter(lambda: f.read(4 * 1024 * 1024), b""):
                    value.update(block)
            return value.hexdigest()
        report = {"restored": True, "integrity": "ok", "foreignKeyViolations": 0,
                  "tables": len(tables), "statements": statements, "sqlBytes": source.stat().st_size,
                  "databaseBytes": target.stat().st_size, "sqlSha256": digest(source),
                  "databaseSha256": digest(target), "rowCounts": counts}
        with manifest.open("x", encoding="utf-8") as f:
            json.dump(report, f)
    finally:
        db.close()


if __name__ == "__main__":
    try:
        restore(*sys.argv[1:])
    except Exception as error:
        # SQL errors can include record content. Never publish their text.
        print(json.dumps({"restored": False, "errorType": type(error).__name__}), file=sys.stderr)
        sys.exit(1)
