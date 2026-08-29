# Ingestion

Coordinates read-only scans across one or more source roots and the existing `roms/` directory of a processed library. Observations are written to the portable SQLite catalog, and a relative-path manifest is updated only after the scan completes.

This package does not export, move, rewrite, or delete ROM files.

