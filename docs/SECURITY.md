# Security and safety

ROM libraries contain untrusted files and containers. RetroRoms must enforce bounded traversal, reject archive path traversal and unsafe links, limit expansion ratios and aggregate extraction size, and isolate temporary files.

The local service binds to loopback only. Source roots are opened read-only by application policy. Export roots require explicit user selection and are validated before each job.

Do not report security vulnerabilities in a public issue. A private reporting channel will be documented before the first executable release.

