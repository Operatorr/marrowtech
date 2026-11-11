# Published capacity evidence

One directory per session, holding only `summary.json` and `SHA256SUMS`. Add a session with:

```sh
pnpm evidence:sync <omega-realm-checkout> <session_id>
```

Never edit these files by hand, and never add raw evidence. A build fails if an inventory does not
match its summary or if a session is a synthetic fixture.

To work on the pages before a real session exists, point a local build at the test data. It renders
under a banner saying nothing ran, and it must never be deployed:

```sh
EVIDENCE_FIXTURES=fixtures/evidence pnpm dev
```
