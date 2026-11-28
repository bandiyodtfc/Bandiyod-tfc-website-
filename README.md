# TFC BANDIYOD — v91.0 release candidate

Based on the uploaded GitHub site and the current Firebase rules supplied in chat. The Firebase project configuration and public site content are preserved. No live data was read or changed.

## Deployment
1. Export a private backup of the current Realtime Database and save the currently published Rules. Keep both off GitHub.
2. Upload the changed files from this package into the existing repository root (not a nested directory). Keep the existing website running while the release builds. Do not approve payments during the transition.
3. Publish the matching `database.rules.json` in Firebase Realtime Database > Rules (NOT Data > Import JSON). The rules and website must be deployed together. Old cached portal versions will not work for the new approval protocol. Refresh / reopen the portal.
4. Admin > Payment Verification > Check Reference Index. Investigate duplicates, mismatches and orphaned keys. After a backup and checking the results, optionally add missing unique references. No existing keys or payment requests are overwritten. Do not accept new payments until the index has been checked.
5. Use a test account and controlled test data to verify login, own-photo-only reads, UPI submission, duplicate rejection across two members, approve/reject, overlapping payment prevention, cash, cancel/restore, membership income and hidden posts. Check a 36-month legacy request and the ₹50–₹3000 automatic selection range.
6. If any test fails, stop payment approvals and revert the GitHub files and published rules together. Never restore a database backup over newly collected payments without reconciliation.

## Changes
- Private member photos: only the owner and admins can read them; the member client subscribes to its own record.
- Hidden post/gallery metadata is excluded by a Firebase query; hidden post images are protected at their direct path. Already downloaded images cannot be recalled.
- UPI request and new paid ticks use one atomic multi-location update; legacy pending records with all ticks already recorded retain recovery. Existing conflicting ticks cannot be overwritten by the normal approval flow.
- Reference index creation is non-overwriting; admin can inspect/backfill historical missing unique references after a backup.
- Existing ₹50–₹3000 / 1–60 month amount range retained. Cancelled earliest due month requires admin reconciliation before a new payment can be submitted (no silent skip or double charge).
- Empty membership income summary clears old rows; JS/CSS cache version updated.

## Verification scope
Local JavaScript syntax and JSON syntax checks only, plus code review. No Firebase emulator or authenticated live testing. The new rules have not been compiled by Firebase. The legacy reference index and live data have not been verified. Admin client-side financial publication, corrections audit immutability and all possible cross-operation races still need separate integration/security testing; this is not a production certification. Existing Firebase historical payment records must not be imported or modified by this update.

## v92.0 — Fest post auto archive
- Based on v91.0, all membership, payment and account files are unchanged.
- Admin Posts: optional Fest end date in IST. Existing dynamic posts are not automatically classified; edit the relevant post and set its date. Ordinary posts remain in Latest Updates.
- A post moves visually to Best Memories after midnight following the end date, on load or within 15 seconds while the page is active. Uses Firebase server time offset when available. The original published record and poster are retained; no database copy, deletion, scheduled Cloud Function, or new public write permission. Hidden posts remain hidden.
- Four built-in Games Fest 2027 posters (including sponsors) move after January 12, 2027; their old ticker items stop at the same cutoff. If the event dates change, update GAMES_FEST_END in tfc-fest-archive.js.
- Publish the matching database.rules.json and deploy site files together; no Data > Import JSON. This is still a release candidate: local syntax/logic checks only, no authenticated Firebase tests.
