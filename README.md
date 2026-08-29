# RetroRoms

RetroRoms is a local-first ROM library curator. It scans one or more user-selected source locations, identifies games from filenames and content hashes, compares them with an existing processed library, and exports a clean portable collection for front ends such as ES-DE.

## Product principles

- Source locations are read-only.
- Identification prefers verified content hashes over filenames.
- Deduplication works across compressed, uncompressed, and nested-container copies.
- Language and region preference is configurable per library.
- Games can be grouped into series across systems.
- Export packaging is configurable per system: automatic, compressed, uncompressed, or preserve.
- Large collection archives are split into independently usable logical game packages.
- The processed library includes its portable catalog and a macOS application in the MVP.
- No ROMs, firmware, BIOS files, or copyrighted artwork are distributed by this repository.

## Proposed stack

The initial scaffold uses TypeScript workspaces with an Electron desktop shell. The application will bundle its browser-based interface and local services into a signed, notarized macOS application. Windows and Linux packaging can reuse the same core and UI packages.

## Repository layout

```text
apps/desktop       macOS MVP application and desktop integration
packages/core      scanning, archive traversal, identification, and export planning
packages/catalog   portable catalog schema and persistence
packages/ui        local browser-based curation interface
docs               requirements, architecture, safety, and format policies
```

## Status

The repository currently contains a tested streaming inventory scanner, bounded nested-archive handling, a portable SQLite catalog, DAT-aware language/region curation, a local browser UI, per-system export profiles, verified export history, and a safe export executor. Source roots are never modified; differing destinations are reported as conflicts unless explicitly overwritten.

```bash
npm run scan -w @retroroms/cli -- \
  --source "/path/to/incoming-roms" \
  --processed "/path/to/processed-library" \
  --name "My ROM Library"
```

Do not use the development CLI on an irreplaceable collection without a separate backup. The macOS bundle is an unsigned MVP and requires Node.js 22+.

## macOS MVP bundle

Build a portable app-style bundle (Node.js 22+ required on the target Mac):

```bash
npm run package:mac -- --output "/path/to/RetroRoms.app"
```

Double-click `RetroRoms.command` inside the bundle and pass the processed-library path to launch the review UI. The bundle also includes the scan CLI for scripted ingestion. Windows/Linux native packaging and signed distribution are planned next.
