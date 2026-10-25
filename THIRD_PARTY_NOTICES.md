# Third-party software

The MIT license in the repository root applies to original FORMA code. It does not replace the licenses of dependencies or vendored code. Preserve their notices when redistributing source or binaries.

The runtime includes a CAD and numerical stack with its own upstream license terms: CadQuery, OpenCascade/OCP, Gmsh, NumPy, SciPy, ReportLab, svglib, ezdxf, matplotlib and their dependencies. JavaScript dependencies include React, Three.js, Vite and the optional Claude Agent SDK. Consult the license files shipped with the installed versions before redistributing a packaged application, runtime or container. In particular, the root MIT license does not make all of the CAD dependencies MIT-licensed.

Exact direct versions are recorded in `package-lock.json`, `worker-node/js/package-lock.json` and `worker-node/requirements.txt`. The Python file pins direct dependencies; it is not a complete transitive lockfile.

Codex, Claude and other model services are separate products. Their accounts, CLI/API usage terms, model weights and subscriptions are not included or relicensed by FORMA. Users configure their own access. FORMA is an independent project and is not endorsed by those providers.
