#!/usr/bin/env python3
"""Compare an extracted TITech source tree to its original ZIP snapshot.

Uses only Python's standard library. Reports changed, added and removed files
with byte sizes and SHA-256 checksums. It does not modify source files.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import zipfile
from pathlib import Path, PurePosixPath


def digest_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def digest_file(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def archive_files(archive_path: Path) -> tuple[dict[str, dict], str]:
    with zipfile.ZipFile(archive_path) as archive:
        comment = archive.comment.decode("utf-8", errors="replace")
        files: dict[str, dict] = {}
        for info in archive.infolist():
            if info.is_dir():
                continue
            parts = PurePosixPath(info.filename).parts
            relative = PurePosixPath(*parts[1:]).as_posix() if len(parts) > 1 else parts[0]
            if relative.startswith(".git/") or "/node_modules/" in f"/{relative}/":
                continue
            data = archive.read(info.filename)
            files[relative] = {"size": len(data), "sha256": digest_bytes(data)}
        return files, comment


def working_files(root: Path) -> dict[str, dict]:
    files: dict[str, dict] = {}
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        relative = path.relative_to(root).as_posix()
        if relative.startswith(".git/") or "/node_modules/" in f"/{relative}/":
            continue
        if relative.endswith("/FILE_CHANGE_MANIFEST.csv") or relative.endswith("/FILE_CHANGE_MANIFEST.json"):
            continue
        files[relative] = {"size": path.stat().st_size, "sha256": digest_file(path)}
    return files


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True, type=Path, help="Original source ZIP")
    parser.add_argument("--root", required=True, type=Path, help="Extracted, updated repository root")
    parser.add_argument("--output", required=True, type=Path, help="Directory for CSV/JSON manifests")
    args = parser.parse_args()

    archive_path = args.archive.resolve()
    root = args.root.resolve()
    output = args.output.resolve()
    if not archive_path.is_file():
        parser.error(f"Archive does not exist: {archive_path}")
    if not root.is_dir():
        parser.error(f"Repository root does not exist: {root}")

    baseline, archive_comment = archive_files(archive_path)
    current = working_files(root)
    rows = []
    for relative in sorted(set(baseline) | set(current)):
        before = baseline.get(relative)
        after = current.get(relative)
        if before is None:
            status = "ADDED"
        elif after is None:
            status = "REMOVED"
        elif before["sha256"] != after["sha256"]:
            status = "MODIFIED"
        else:
            continue
        rows.append({
            "status": status,
            "path": relative,
            "original_size_bytes": before["size"] if before else None,
            "updated_size_bytes": after["size"] if after else None,
            "original_sha256": before["sha256"] if before else None,
            "updated_sha256": after["sha256"] if after else None,
        })

    output.mkdir(parents=True, exist_ok=True)
    csv_path = output / "FILE_CHANGE_MANIFEST.csv"
    json_path = output / "FILE_CHANGE_MANIFEST.json"
    fields = ["status", "path", "original_size_bytes", "updated_size_bytes", "original_sha256", "updated_sha256"]
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)

    summary = {
        "sourceArchive": archive_path.name,
        "archiveComment": archive_comment,
        "repositoryRoot": str(root),
        "generatedAtUtc": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "counts": {
            "modified": sum(row["status"] == "MODIFIED" for row in rows),
            "added": sum(row["status"] == "ADDED" for row in rows),
            "removed": sum(row["status"] == "REMOVED" for row in rows),
            "totalChanged": len(rows),
        },
        "changes": rows,
    }
    json_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"counts": summary["counts"], "csv": str(csv_path), "json": str(json_path)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
