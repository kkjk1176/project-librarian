# Maintainer Guide

## Development

```bash
npm install
npm run typecheck
npm run build
npm run unit
bash tests/smoke.sh
```

`npm run build` removes the previous root `dist/`, compiles TypeScript, and synchronizes checked-in skill runtime copies. Rebuild after changing `src/`, templates, package metadata, or skill behavior.

## Verification

- Parser or mode changes: update focused unit tests.
- Generated wiki changes: test a fresh `init` and an existing-wiki `update`.
- Routing changes: cover query, impact, neighborhood, links, quality, and doctor behavior as applicable.
- Skill runtime changes: verify both checked-in skill copies after the build.
- Packaging or workflow changes: run `npm test`, `npm run audit:supply-chain`, and `npm pack --dry-run --json`.

Keep validation proportional to the change. The product quality bar is whether project knowledge is clearly owned, routed, current, and recoverable.

## Distribution

The package includes `agents/`, `docs/`, `dist/`, the READMEs, contribution guide, license, and root skill. `prepack` rebuilds generated runtime output.

The publish workflow preserves trusted publishing:

1. install with `npm ci`;
2. run `npm test` and the production dependency audit;
3. inspect the npm package with `npm pack --dry-run --json`;
4. publish from a release or approved release tag using GitHub OIDC.

Do not publish locally with a long-lived npm token.
