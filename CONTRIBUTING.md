# Contributing to FORMA

FORMA is an open-source engineering workbench. Contributions are welcome through issues and pull requests.

1. Read the numerical and manufacturing limitations in [README.md](README.md).
2. Follow [the local setup guide](docs/SELF_HOSTING.md). Use your own credentials and local database.
3. Keep changes focused and explain the concrete behavior being changed.
4. Run TypeScript validation and a production build for web changes. For CAD, kinematics, meshing, drawings or solver changes, run the engineering suite as well:

   ```sh
   npx tsc --noEmit
   npm run build
   .venv/bin/python -m pytest tests/test_cad.py tests/test_engineering.py -q
   ```

Numerical changes need independent evidence: an analytical reference, a reproducible benchmark or a validated external result. Do not merely copy implementation outputs into assertions. Preserve units, material assumptions, boundary conditions, mesh convergence checks and explicit failure states. Never represent hand-authored examples as AI-generated results or a passing test as approval for manufacturing.

For interface changes, include screenshots and explain the complete workflow you checked. Keep CAD generation declarative; do not execute arbitrary model-generated Python. New AI providers must distinguish discovered models from successfully exercised models.

Do not include credentials, personal projects, generated customer parts, local databases or node logs in a commit. See [SECURITY.md](SECURITY.md) for private vulnerability reporting.

By contributing, you agree that your original contributions are provided under the repository's MIT license. Preserve existing third-party notices. No contributor license agreement is required.
