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

The repository currently contains the product and architecture scaffold. Implementation will proceed in small, testable milestones beginning with inventory scanning and a read-only catalog.

