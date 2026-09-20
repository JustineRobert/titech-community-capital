# TITech Runtime Import Audit

This document records a static import-resolution audit that complements the repository syntax gate.
Syntax parsing does not prove that relative runtime imports exist or that ESM/CommonJS boundaries are
loadable under the repository's `"type": "module"` backend configuration.

## Audit command

```bash
node scripts/runtime-import-audit.mjs
```

## Acceptance rule

The canonical financial surface must have:

- zero missing local imports;
- zero `require()`/`createRequire()`/`module.exports` constructs in canonical ESM financial modules.

The broader legacy backend may still report missing local imports. Those are recorded as consolidation
work rather than silently treated as production-ready.
