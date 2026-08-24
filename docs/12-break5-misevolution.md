# BREAK 5 — Misevolution guardrails around constitution amendment

## Why

`HarnessEvolver.evolve()` is a self-mutation. It rewrites the
constitution that the next candidate will be reviewed against. If the
mutation is wrong, every subsequent run is wrong too. The Your Agent May
Misevolve paper (arXiv 2509.26354) calls this misevolution: the
harness keeps improving itself into a corner.

We add three guardrails.

## 1. Cooldown window

```ts
const evolver = new HarnessEvolver();
const first  = await evolver.evolveDetailed(ledger, constitution, {
  threshold: 2,
  cooldownMs: 60_000,
});
// first.learned.length === 1 — first verify failure type is amended.

const second = await evolver.evolveDetailed(ledger, constitution, {
  threshold: 2,
  cooldownMs: 60_000,
});
// second.learned.length === 0 — cooldown is in effect, no new amendment.
```

The evolver keeps a wall-clock timestamp per failure type. A second
amendment of the same type within `cooldownMs` is skipped, regardless of
the failure count.

## 2. Regression eval gate

```ts
const evolver = new HarnessEvolver();
const result = await evolver.evolveDetailed(ledger, constitution, {
  threshold: 2,
  regressionEval: async (candidate) => {
    const sampleIds = ['eval-1', 'eval-2'];
    const ok = await runEvalSuite(candidate, sampleIds);
    return { ok, sampleIds };
  },
});
if (!result.learned.length) {
  // The amendment was refused; an oversight.escalated event was appended
  // with reason=regression-gate-refused-amendment and the eval samples.
}
```

If the regression gate returns `{ ok: false }`, the evolver:

1. Does not amend the constitution.
2. Appends an `oversight.escalated` event carrying the eval samples.
3. Records the type as refused in `EvolveResult`.

If the gate throws, an `oversight.escalated` with reason
`regression-eval-threw` is appended instead.

## 3. Grounded amendment payload

Every `constitution.amended` event now carries:

```ts
{
  failureType: 'verify',
  count: 3,
  principleId: 'learned:verify',
  statement: '...',
  evidenceEventIds: [evt1, evt2, evt3],
  evalSampleIds: ['eval-1'],
  diff: {
    before: null,
    after: 'A feature must pass ...',
    failureType: 'verify',
    count: 3,
  },
  cooldownMs: 60_000,
}
```

## Tests

- harness evolver respects cooldown window against repeat failures
- harness evolver refuses an amendment that regresses the eval suite
- constitution.amended payload carries evidence ids, eval samples, and a diff

## What we deliberately do not do

- We do not auto-rollback a bad amendment after the fact. The audit
  trail is append-only; the right move is to refuse the amendment at
  amend-time, which is what the regression gate does.
- We do not let the regression eval mutate the ledger. It returns a
  verdict; the evolver decides whether to record the amendment.
- We do not collapse the cooldown to zero for critical amendments. If
  the operator needs an emergency override, they call
  `constitution.add(principle)` directly — that path is intentionally
  outside the evolver so misuse is visible.
