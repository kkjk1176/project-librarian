# Contributing

Thanks for considering a contribution. Project Librarian is a small maintainer-led project, so the best contributions are focused, reproducible, and easy to review.

## Before Opening A PR

- Open or reference an issue for behavior changes, new public options, or release-process changes.
- Keep changes scoped to one reviewable problem.
- Do not add dependencies unless the issue or PR explains why the existing standard library or local utilities are not enough.
- For security reports, do not open a public issue with exploit details. Use [SECURITY.md](SECURITY.md).

## Local Setup

```bash
npm install
npm run typecheck
npm run build
npm test
```

When editing TypeScript under `src/`, rebuild before committing so `dist/` stays current.

## Verification

Use the smallest validation that proves your change:

- Documentation-only changes: verify links and keep English/Korean guides aligned when both exist.
- CLI behavior changes: add or update unit tests, then run `npm test`.
- Generated output changes: run `npm run build` and verify checked-in skill runtime copies.
- Package or trusted-publishing changes: run `npm test`, `npm run audit:supply-chain`, and `npm pack --dry-run --json`.

## Documentation

Keep the README first-screen focused. Put detailed usage, CLI reference, and maintainer operations in `docs/`.

When README content changes, keep `README.ko.md` aligned in meaning.
