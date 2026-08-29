# Security and safety

ROM libraries contain untrusted files and containers. RetroRoms enforces bounded traversal, rejects archive path traversal, limits entry size, archive expansion, compression ratio, nesting depth, entry count, listing output, and helper execution time, and isolates temporary files with owner-only permissions.

The local service binds to loopback only. Source roots are opened read-only by application policy. Export roots require explicit user selection and are validated before each job.

Do not report security vulnerabilities in a public issue. A private reporting channel will be documented before the first executable release.
