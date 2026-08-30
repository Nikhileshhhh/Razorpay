# Domain modules

Each subdirectory is a domain module (architecture handoff §6). Modules
communicate through application commands and persisted domain events; a module
**must not** write another module's tables directly, and integrations **must
not** depend on module internals.

MT-001 leaves these as empty, boundary-anchoring placeholders. Implementations
arrive in their assigned tasks (MT-004 onward).
