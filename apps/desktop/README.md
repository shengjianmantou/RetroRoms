# Desktop application

The macOS MVP packages the local API, browser UI, archive handlers, and catalog migrations into an app-style bundle. `launch.mjs` is platform-aware and opens the default browser via `open`, `xdg-open`, or Windows `start`; native Windows/Linux installers can reuse this launcher contract. Application data remains beside the processed library rather than inside the application bundle.
