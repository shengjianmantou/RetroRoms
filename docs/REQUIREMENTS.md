# Product requirements

## Library locations

RetroRoms operates on two kinds of user-selected locations:

1. One or more read-only source locations containing ROMs to process.
2. One processed-library location previously created or adopted by RetroRoms.

The processed library is compared with every source scan so already-exported content can be recognized regardless of filename or packaging.

## Input discovery

- Read ordinary ROM and disc-image files.
- Inspect ZIP, 7z, RAR, TAR, compressed TAR, and supported native compressed-image formats.
- Traverse nested archives within configurable depth, file-count, time, and expanded-size limits.
- Represent nested members with stable virtual paths such as `outer.7z::inner.zip::game.sfc`.
- Detect encrypted, corrupt, multipart, unsupported, suspicious, and archive-bomb inputs without modifying the source.
- Group dependent files into logical games, including BIN/CUE and multidisc M3U sets.
- Preserve arcade parent, clone, device, and BIOS relationships where the selected emulator requires them.

## Identification and deduplication

- Hash the normalized ROM payload rather than relying on archive checksums.
- Store CRC32, MD5, SHA-1, and SHA-256 when relevant to available identification catalogs.
- Prefer verified DAT or serial-number matches, with parsed filenames as a fallback.
- Deduplicate compressed and uncompressed representations of the same content.
- Retain alternatives while selecting a preferred edition using configurable language and region ranking.
- Initial language preference: English, then Chinese, then Japanese; users can reorder or disable this rule.

## Export packaging

Each system has an output policy:

- `auto`: infer the dominant compatible single-game format already observed for that system.
- `compressed`: export one independently usable compressed package per logical game.
- `uncompressed`: export the emulator-facing game files directly.
- `preserve`: retain the existing per-game representation when compatible.

Compressed output also has an explicit format override. Archive formats such as ZIP and 7z are distinct from CHD, RVZ, CSO, and PBP image formats and require separate conversion handlers.

Large multi-game archives are decomposed into individual logical game packages. A logical game may contain multiple required files or discs.

## Portable processed library

```text
Processed ROM Library/
├── ROM Curator.app
├── rom-curator-macos
├── roms/
├── media/
├── es-de/
└── .rom-curator/
    ├── catalog.sqlite
    ├── manifest.json
    ├── library.json
    └── backups/
```

- All catalog paths are relative to the processed-library root.
- The active local database writes a portable snapshot after a successful export.
- Exports stage, verify, and then commit files before updating the portable catalog.
- Repeating an export skips content already verified in the processed library.
- The macOS MVP includes a signed, notarized universal application and a command-line fallback.
- Future Windows and Linux executables use the same portable library schema.
- Secrets and provider credentials are not written to the portable library by default.

