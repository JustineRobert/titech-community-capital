# TITech Community Capital — Production Readiness

# Dependency Risk Register

Key runtime risk: local sandbox toolchain is below the repository target and child dependencies are not guaranteed to be installed.

Control: CI/staging must use Node 24.15.x and npm 11.x with committed lockfiles. The repository must not translate local sandbox limitations into false production claims.
