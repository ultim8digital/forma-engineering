# Security

## Reporting

Please use [GitHub private vulnerability reporting](https://github.com/ultim8digital/forma-engineering/security/advisories/new) for security-sensitive reports. Do not post credentials, exploitable details or private CAD models in a public issue. Include the affected commit, reproducible steps, expected boundary and impact.

## Deployment boundaries

- FORMA currently targets a trusted owner and their own compute node. It does not provide tenant isolation for a public multi-user service.
- The local sign-in shim is for loopback development only. It is not production authentication.
- The deployed application trusts `oai-authenticated-user-*` headers from the Sites gateway. A generic reverse proxy must strip untrusted copies and perform authentication before forwarding verified identity. Do not expose the Worker directly with client-supplied identity headers.
- Use distinct random worker tokens for each deployment. Keep `.env.node`, `.dev.vars`, provider credentials, service access tokens and generated project data out of Git.
- CLI providers run with the compute owner's permissions. Only trusted requests should reach that node. Isolate the CAD runtime before accepting untrusted public workloads.
- Generated CAD operations are validated declarative data. Do not replace this boundary with arbitrary Python execution.

The newest `main` branch is the current maintenance target. Engineering correctness concerns can be reported as public issues when they contain no sensitive data; include units, assumptions and an independently reproducible reference.
