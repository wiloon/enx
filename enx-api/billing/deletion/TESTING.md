# Issue #337 regression evidence

Review round 1 corrected the original PR's red-test claim: skipping live
lookups does **not** make `TestAStoredTerminalSubscriptionIsNotLookedUp` fail.
That test expects no lookup and is not evidence for the cancellation regression.

The following red/green check was run on 2026-10-26:

1. Temporarily replace `owned[i].Live = &sub.Live` in `Service.Check` with
   unused-variable assignments, disabling live-state enrichment while keeping
   the package compilable.
2. From `enx-api`, run:

   ```sh
   GOCACHE=/tmp/enx-432-go-cache go test ./billing/deletion -run '^TestACanceledPortalSubscriptionInFlexibleBillingModeDoesNotBlockDeletion$' -count=1 -v
   ```

   The test fails (exit 1) with:

   ```text
   deletion_test.go:45: Check = 3, <nil>; want DeletionAllowed
   ```

   Verdict 3 is `DeletionBlockedLookup`: without the live cancellation data,
   the stored active subscription blocks deletion instead of allowing it.
3. Restore the original enrichment assignment and run
   `GOCACHE=/tmp/enx-432-go-cache go test ./billing/deletion -count=1 -v`.
   All five tests pass, including the sandbox cancellation test.

The temporary mutation is not part of the committed implementation. No behavior
or test changes were needed; this record supersedes the incorrect red-test claim.
