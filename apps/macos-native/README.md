# RetroRoms Native for macOS

This SwiftUI client replaces the browser-based review screen with native folder pickers, a selectable game catalog, grid/list views, local artwork, and export controls. It invokes the existing local Node scanner/export service; ROM source directories remain read-only.

Development build:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift build --package-path apps/macos-native
RETROROMS_HOME="$PWD" .build/debug/RetroRomsNative
```

The release packager will bundle the Node runtime assets alongside this app in the native branch.
