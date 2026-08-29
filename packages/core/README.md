# Core

Format detection, bounded archive traversal, logical-game grouping, content hashing, identification, deduplication, system policy, and verified export planning.

The current scanner streams ordinary files and archive members through incremental hashing. ZIP, TAR, and GZIP are exercised against the macOS `bsdtar` development adapter; 7z and RAR use the same adapter contract. Release builds will bundle and invoke a pinned archive helper rather than depend on a system installation.

Archive output is written only to private temporary files, bounded by per-entry size, per-archive expanded size, compression ratio, nesting depth, entry count, listing size, and command timeout. Temporary files are removed after each archive is inspected.
