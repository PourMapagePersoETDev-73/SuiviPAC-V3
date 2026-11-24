# Security Specification — Suivi PAC Firestore Rules

## 1. Data Invariants
1. **Strict Owner Isolation**: Every workspace, daily entry, reference configuration, and goal configuration is strictly scoped to `/users/{userId}` where `request.auth != null`, `request.auth.token.email_verified == true`, and `request.auth.uid == userId`.
2. **Master Gate Verification**: Subcollections (`/entries`, `/reference`, `/goals`) enforce parent ownership via `get(/databases/$(database)/documents/users/$(userId)).data.ownerId == request.auth.uid` on single-document operations and enforce `resource.data.ownerId == request.auth.uid` on `allow list` queries.
3. **Immutable Ownership & Timestamps**: `ownerId` and `createdAt` cannot be modified after creation. `createdAt` and `updatedAt` must equal `request.time`.
4. **Strict Schema & Size Guards**: Every document enforces exact `hasAll` + `hasOnly` keys on create, `affectedKeys().hasOnly(...)` on update, numeric bounds, and `.size()` caps on all strings and maps.
5. **Client Secret Isolation**: GitHub Pages credentials (`github_token`, `github_password`) are never stored in Firestore.

## 2. Adversarial "Dirty Dozen" Payloads (Expected: PERMISSION_DENIED)
1. **Unauthenticated read/write**: Reading `/users/uidA/entries/2026-11-18` with `auth == null`.
2. **Cross-user access**: User B (`uidB`) reading or writing `/users/uidA/entries/2026-11-18`.
3. **Unverified email write**: Authenticated user with `email_verified: false` creating or updating `/users/uidA/entries/2026-11-18`.
4. **Owner spoofing on create**: User A creating `/users/uidA/entries/2026-11-18` with `ownerId: "uidB"`.
5. **Owner tampering on update**: User A updating `ownerId` on an existing entry or workspace document.
6. **Ghost / Shadow field injection**: Adding `isAdmin: true` or `role: "admin"` to `/users/uidA` or `/entries/...`.
7. **Invalid document ID injection**: Creating `/users/uidA/entries/../../../etc/passwd` or a 200-char ID or non-ISO date key.
8. **Type poisoning**: Sending `edf_eur: "999"` (string instead of number/null) or `remarque: 12345` (number instead of string/null).
9. **Oversized string DoS**: Sending `remarque` of 5,000 characters (`> 500`).
10. **Client-forged timestamp**: Creating/updating a document with a backdated `createdAt` or `updatedAt != request.time`.
11. **Wildcard list scraping**: Listing `/users` or listing `/users/uidA/entries` without matching `ownerId`.
12. **Arbitrary config doc ID**: Creating `/users/uidA/reference/rogueDoc` instead of `'current'`.
