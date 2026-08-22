## What this changes

<!-- One or two sentences. Link the issue if there is one. -->

## Verification

All four must pass before review. Paste the real output, not a claim.

```
npm run typecheck
npm run lint
npm test
npm run build
```

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build`

## If this touches the catalog

- [ ] Every new or changed dimension has a **published source**, cited in the
      code or in `findings.md`. Guesses are marked `// UNVERIFIED`.
- [ ] Article numbers are per-market — they differ between countries.
- [ ] `packQty` is right. Several SKUs are multipacks, and costing per unit
      silently under-orders.

## If this touches saved state

- [ ] The persist `version` is bumped and `migrateConfig` handles the old shape.
- [ ] A test in `src/state/store.test.ts` covers the migration. A saved wall
      breaking on upgrade is the one failure the app cannot reproduce itself.
