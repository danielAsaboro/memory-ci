# Stash Devpost Recording Shot List

Target export: 1920×1080, 30 fps, 2:45 target, 2:55 absolute editorial ceiling. The Devpost limit is under three minutes.

## Before recording

- Use a clean anonymous browser profile at 100% zoom.
- Create a fresh workspace and confirm the namespace is prefilled in the proposal form.
- Seed one safe baseline with two versions so forward rollback is visible.
- Confirm the semantic retrieval UI returns an active memory and writes a read receipt.
- Confirm the live evaluation queue reaches a terminal result; trim provider wait time in the edit instead of implying an instant response.
- Prepare sanitized terminal output for the vector column, index definition, index job, `EXPLAIN`, and `ccloud` cluster JSON.
- Open `docs/evidence/stash-production.json` with account identifiers redacted.
- Hide bookmarks, notifications, credentials, AWS account IDs, tokens, cookies, and private URLs.
- Record narration separately if live narration makes the workflow error-prone.

## Recording order

| Take | Time in edit | Capture | Pass condition |
|---|---:|---|---|
| 1 | 00:00–00:15 | `/overview` | Counts and active revision are readable |
| 2 | 00:15–00:40 | poison proposal and change detail | Two findings, quarantined state, approval disabled |
| 3 | 00:40–01:18 | safe proposal, evaluation, review | Provider request ID and approval binding visible |
| 4 | 01:18–01:43 | promote and memory detail | New active revision visible |
| 5 | 01:43–02:10 | semantic retrieval and read receipt | Meaning-based match, score, revision, receipt |
| 6 | 02:10–02:29 | sanitized terminal and evidence JSON | Vector index, `ccloud`, AWS receipts readable |
| 7 | 02:29–02:45 | rollback, audit, closing URLs | New forward revision and audit event visible |

## Editing assets

- Use `stash-thumbnail-source.png` as the thumbnail base; avoid adding claims not proved in the footage.
- Use the eight `captures/*.jpg` files as evidence inserts, freeze frames, or recovery coverage.
- On-screen callouts should be short: “2 blocking findings,” “Bedrock provider receipt,” “atomic promotion,” “VECTOR(1024),” “persisted read receipt,” and “forward-only rollback.”
- Use hard cuts and restrained punch-ins. Avoid generic AI imagery, decorative stock footage, or animated architecture that consumes proof time.
- Keep identifiers on screen for at least two seconds and crop them only after confirming they contain no secrets.

## Final user-owned checks

- Export duration is below `180.0` seconds.
- Captions match the final spoken edit; retime `captions.vtt` if delivery or cuts change.
- The video visibly identifies at least two qualifying CockroachDB tools and at least one AWS service.
- The public repository and `https://trystash.xyz` are readable before the close.
- Upload to public YouTube or Vimeo and test the URL while logged out.
- Codex does not perform the recording, assembly, rendering, upload, or publication.
