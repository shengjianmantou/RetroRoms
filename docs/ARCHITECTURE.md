# Architecture

## Components

```text
Desktop shell and browser UI
            |
       local application API
            |
  scan and curation coordinator
     /          |           \
archive      identity       export
workers       engine        planner
     \          |           /
       local working catalog
                |
      portable catalog snapshot
```

### Desktop application

Locates or creates the processed library, starts the local services, and hosts the curation UI. It must run without a separately installed language runtime.

### Scanner

Enumerates user-approved roots, detects formats by content and extension, traverses containers safely, and emits immutable file observations and logical-game candidates.

Ordinary files and extracted archive members are hashed incrementally. An archive-helper interface lists members and streams one member at a time into a private temporary file, allowing nested inspection without holding multi-gigabyte games in memory. The macOS release bundle will carry a pinned libarchive-compatible helper for ZIP, TAR, GZIP, 7z, and RAR input.

### Identity engine

Calculates payload hashes, queries imported identification catalogs, parses release metadata, and associates representations with canonical games, editions, systems, and series.

### Curation engine

Applies language, region, revision, and packaging preferences without deleting alternatives. User decisions override inferred choices and are persisted.

### Ingestion coordinator

Runs source scans and an existing processed-library scan under one catalog job. Source observations retain their selected root, processed observations use paths relative to the portable-library root, and the manifest is written only after the catalog scan completes.

### Export planner

Produces a dry-run plan, reserves destination paths, transforms packaging, verifies results, commits atomically where supported, and updates the portable catalog snapshot last.

## Invariants

- Never write to a source location.
- Never regard an enclosing archive checksum as the game-content identity.
- Never update the portable catalog before exported content is verified.
- Never silently replace an existing destination file with different content.
- Never persist provider credentials in a portable library unless explicitly enabled.
