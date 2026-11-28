# Delivery slips — unified administrative lifecycle test plan

## Scope
This lot applies to both MANUAL and AUTOMATIC delivery slips. It is additive and must be applied only after migrations DELIVERY-SLIPS-01 through DELIVERY-SLIPS-04.

## Locked recount rules
- DRAFT, SUBMITTED, VALIDATED and ARCHIVED lines count in the active slipped total.
- CANCELLED lines do not count; their quantities are immediately available again.
- A permanently deleted slip no longer contributes to the total. The complete header and line snapshot remains in audit_events.
- ARCHIVED is not cancellation: it remains counted.
- School report source data and delivery operation records are never changed by slip cancellation, archive or deletion.
- Only CENTRAL_ADMIN may edit a slip at any status, cancel/archive it, or permanently delete it.
- Manual and automatic slips share the same group-level recount source, including legacy manual lines whose source_pedagogical_group_id is NULL.

## Required DEV test fixtures
Use one test school, one active school year, and at least two pedagogical groups with reports and known delivery totals. Record the expected delivered total for each group before creating slips.

## Functional test matrix

| Test | Action | Expected result |
|---|---|---|
| R01 | Create a manual draft line below available quantity | Accepted; active slipped total increases |
| R02 | Add a manual line above available quantity | Rejected with requested/available quantities |
| R03 | Generate an automatic draft after a manual draft | Automatic available quantity excludes the manual draft |
| R04 | Create manual and automatic slips for the same group | No double-counting; combined total cannot exceed delivered quantity |
| R05 | Submit a draft | Still counted |
| R06 | Validate a submitted slip | Still counted |
| R07 | Cancel a validated manual slip | Status becomes CANCELLED; its full line quantity is immediately released |
| R08 | Cancel an automatic slip | Same result as manual cancellation |
| R09 | Recompute candidates after cancellation | available_to_slip increases by the cancelled quantity |
| R10 | Archive a submitted or validated slip | Status becomes ARCHIVED; its quantity remains counted |
| R11 | Recompute candidates after archive | available_to_slip does not increase |
| R12 | Delete a DRAFT, SUBMITTED, VALIDATED, CANCELLED or ARCHIVED slip as central admin | Slip and lines are deleted; quantity is released if it was counted; audit snapshot remains |
| R13 | Attempt permanent deletion as Category 1 or Category 2 | Rejected by PostgreSQL permissions/RPC authorization |
| R14 | Attempt edit/cancel/archive as non-admin | Rejected |
| R15 | Correct metadata and quantities as central admin on each status | Accepted only when quantity remains within available total for counted statuses |
| R16 | Correct an archived slip | It remains ARCHIVED and remains counted |
| R17 | Correct a cancelled slip | It remains CANCELLED and remains excluded |
| R18 | Inspect audit after correction | Before and after metadata/line snapshots and reason are present |
| R19 | Inspect audit after deletion | Full deleted header/line snapshot and reason remain |
| R20 | Inspect source reports after all lifecycle operations | No source report values or delivery operations were modified |

## Concurrency test
Run two sessions attempting to add/generate slips for the same school and group at the same time. School-row locking should serialize the recount mutations. The second operation must see the first operation's committed quantity and must not oversubscribe the delivered total.

## Regression checks
- Existing manual creation, submission, validation and printing.
- Automatic draft creation, draft edit, submission, validation, history and print preview.
- Existing department-level RLS visibility.
- Existing organization snapshot and logo rendering.
- No direct table write privileges added.
- Confirm the automatic draft delete button is no longer available to non-admin users; permanent deletion is exclusively through the central-admin panel.

## Deployment sequence
1. Pull this branch and run frontend tests/build.
2. Apply the migration to DEV only.
3. Run all R01–R20 tests and the concurrency test.
4. Review audit_events and verify source reports are unchanged.
5. Apply to STAGING and repeat the test matrix.
6. Production application only after explicit approval and a verified backup.
