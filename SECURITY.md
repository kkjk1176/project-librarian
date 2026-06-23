# Security Policy

## Supported Versions

Security fixes are handled for the latest published `project-librarian` npm version and the current `main` branch. Older pre-1.0 releases may receive a fix only when the issue is practical to backport without weakening the current release contract.

## Reporting A Vulnerability

Report suspected vulnerabilities privately through this repository's GitHub private vulnerability reporting / Security Advisories flow. If GitHub's private report flow is unavailable, open a minimal GitHub issue asking for a private security contact path without posting exploit details, secrets, tokens, or live sensitive data.

Please include:

- affected version or commit
- affected command, workflow, or generated file
- impact and expected preconditions
- a minimal reproduction that does not expose real credentials or private data

## Response Expectations

The maintainer will acknowledge actionable reports as soon as practical, triage severity, and publish fixes through the normal GitHub Release and npm trusted-publishing workflow. Public disclosure should wait until a fix or mitigation is available unless active exploitation requires faster coordination.

## Supply-Chain Boundary

Package publication must continue to use GitHub OIDC trusted publishing. Do not request or introduce npm token secrets for the normal release path.
