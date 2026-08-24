# BREAK 4 — Tamper-evident WAL + idempotent effects

## Why

Two failure classes that an append-only ledger cannot catch on its own:

1. **Replay rewrite.** A long-running agent has thousands of events. A
   reviewer who restarts the harness and calls `Ledger.load()` has no
   way to tell whether someone (or a bug) rewrote events 12 and 47 between
   writes.
2. **Double-applied side effects.** A tool call succeeds, the agent
   crashes, the harness restarts and re-issues the same call. The world
   gets the side effect twice and the second one corrupts the first.

These are exactly the failure modes that motivated WAL in databases and
idempotency keys in payment APIs. We borrow both ideas into the ledger.

## What changed

### Event carries prevHash and hash

```ts
export interface Event {
  id: string;
  seq: number;
  at: Timestamp;
  type: EventType;
  actor: string;
  payload: Record<string, unknown>;
  parent?: string;
  evidence?: string;
  prevHash: string;
  hash: string;
  idempotencyKey?: string;
}
```

The canonical form is a JSON-serialised subset that excludes `at` so the
chain is stable across serialisation boundaries. `Ledger.append()` computes
both fields; `Ledger.load()` re-hashes every line and throws
`ledger-chain-broken` if any link does not match.

### effect.intent is the WAL preamble

Before any `effect.requested` event, the planner appends an `effect.intent`
event carrying the same `idempotencyKey`:

```
effect.intent   ─┐
                 ├─ idempotencyKey = sha256(tool + scope + featureId + payload)
effect.requested─┘
checkpoint.created
effect.actualized
...
```

If the same effect is retried (e.g. after a checkpoint rollback), the
intent is appended once with that key; subsequent attempts look up the
existing intent and return it instead of appending a duplicate. This is
the exactly-once effect guarantee at the audit layer.

### Sandbox.execute() is idempotent by SHA-256

```ts
const r1 = await sandbox.execute('fs', { featureId: 'f1' }, { featureId: 'f1' });
const r2 = await sandbox.execute('fs', { featureId: 'f1' }, { featureId: 'f1' });
// r2.deduped === true, r2.output === r1.output
```

### validateLedger() re-walks the chain

```ts
const result = validateLedger(ledger);
// result.chainChecked === ledger.length
// result.ok === true if every event re-hashes to its stored hash AND every
// prevHash matches the previous event's hash.
```

## Tests

- ledger builds a tamper-evident hash chain with prevHash/hash linkage
- validator detects a tampered event in the hash chain
- effect.intent is recorded before effect.requested with matching idempotency key
- sandbox dedupes repeat tool calls by idempotency key

## Demo output

```
== Ledger integrity ==
61 events, VALID
```

The 4 extra events (vs the previous 57) are: 1 effect.intent per verified
effect (scaffold, persist) and the matching top-level idempotencyKey field
on each effect.requested.
