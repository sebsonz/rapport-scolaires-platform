# Production Evolution and Data Safety Policy

**Project:** RAPPORTS SCOLAIRES 2026–2027  
**Status:** Architecture rule — mandatory for future development  
**Scope:** Application code, database schema, school reports, organization data, access control, audit history, deployments and backups.

## 1. Core commitment

The platform must remain evolvable after it enters production. New features may be introduced progressively without rebuilding the product or deleting existing operational data.

The following principles are mandatory:

- Preserve existing school, report, user, organization and operational-history records.
- Prefer backward-compatible, additive database changes.
- Never use destructive schema or data changes as a routine deployment technique.
- Keep tenant, department, school and role boundaries enforced by PostgreSQL Row Level Security (RLS) and server-side authorization.
- Preserve historical records and audit trails.
- Deploy changes progressively and verify them before promoting them to production.

A successful frontend deployment does not, by itself, prove that a database migration or the complete application is safe.

## 2. Environments and promotion path

The intended deployment path is:

1. **DEV** — development and technical verification.
2. **STAGING / PREPRODUCTION** — validation against a production-like configuration and representative test data.
3. **PRODUCTION** — real users and authoritative data.

Rules:

- Keep environment credentials, Supabase projects and deployment configuration separated.
- Never point a development or preview build at the production database by accident.
- Do not copy production personal data into DEV or STAGING unless an explicitly approved, protected process makes it necessary. Prefer anonymized or synthetic data.
- Promote a change only after its code, migration, permissions and critical user journeys have been validated.
- Production deployment and production database changes require explicit authorization.

## 3. Database migration policy

Every database schema change must be versioned in the repository as a migration.

### Preferred migration patterns

- Add a nullable column before requiring it.
- Add new tables without removing or rewriting existing tables.
- Backfill existing records in controlled, verifiable batches when needed.
- Introduce new constraints only after existing data has been checked and corrected through an approved process.
- Use compatibility views, functions or transitional fields when old and new application versions may coexist.
- Keep migrations deterministic, ordered and safe to review.

### Prohibited without explicit approval

- Dropping tables, columns, schemas, policies or functions that may still be used.
- Truncating tables or bulk-deleting operational records.
- Replacing production data with development data.
- Rewriting historical reports or immutable snapshots.
- Applying unreviewed migrations directly to production.

For every sensitive migration, document its purpose, affected objects, expected impact, preconditions, verification queries and recovery approach.

## 4. Historical data and audit integrity

Historical data is part of the platform's business record.

- Do not delete validated school reports or historical operations to simplify a new feature.
- Keep audit and operation history append-only wherever the business process requires it.
- Corrections must be represented by traceable correction operations, not silent overwrites.
- Preserve the identity and relevant organization snapshot attached to historical documents when the business rules require it.
- Record who performed a sensitive administrative action, when it happened and what changed.
- Administrative interfaces must not bypass database-level immutability or authorization rules.

Existing report-entry permissions remain mandatory:

- Category 1 may enter columns A, B, C, D and F.
- Category 2 may enter columns I, K and L.
- Column G is reserved exclusively for the central administrator.
- Column H is calculated automatically by the system.
- Departmental members may consult the complete reports of their schools but may modify only their authorized columns.
- Super Admin school-detail views remain read-only unless a separately approved business rule explicitly changes this.

## 5. Access control and multi-tenancy

Every new feature must preserve the existing isolation model.

- Enforce authorization on the server and in PostgreSQL RLS; hiding a button in the frontend is not authorization.
- Validate the user's role, department, school and organization scope for every sensitive operation.
- Do not trust tenant or organization identifiers supplied by the browser without server-side verification.
- Test both allowed and denied access paths, including cross-department and cross-organization attempts.
- Keep privileged database functions narrowly scoped and verify their authorization checks.
- Do not weaken existing policies merely to make a new screen work.

## 6. Backup and recovery before sensitive changes

Before a production migration or other sensitive operation:

1. Confirm that a recent recoverable backup exists.
2. Record the backup time and the target environment.
3. Review the migration and its expected effects.
4. Define how the application will behave if deployment is interrupted.
5. Define whether recovery requires restoring data, rolling back application code, or applying a forward-fix migration.
6. Verify critical records and access rules after the change.

A backup is not considered reliable until its restoration procedure has been tested. The rollback of frontend code does not automatically reverse a database migration.

## 7. Release and validation gates

A change must pass the relevant checks before promotion:

- TypeScript and production frontend build.
- Automated unit and integration tests available for the affected modules.
- Migration review and validation against the intended database version.
- RLS and authorization tests, including negative access tests.
- Verification that existing reports and historical records remain intact.
- Smoke tests for login, role-based navigation, report consultation and authorized data entry.
- Verification of new feature workflows and audit events.
- Review of application logs and database errors after deployment.

If a required check cannot be run, record it as **not verified**. Do not describe the feature or release as production-ready until the missing checks are completed.

## 8. Deployment and recovery strategy

Use a staged release:

1. Merge or promote only an approved, reviewed change.
2. Deploy the compatible database migration to DEV.
3. Run automated tests and targeted data-integrity checks.
4. Deploy to STAGING and validate complete user workflows.
5. Confirm backup and recovery readiness.
6. Obtain explicit production authorization.
7. Apply the production migration and deploy the compatible application version in the planned order.
8. Run post-deployment smoke tests and verify data integrity.
9. Monitor errors and access-denied events.

Prefer forward-compatible fixes over destructive rollback. If a migration has already changed production data, do not assume that reverting the application code restores the previous database state.

## 9. Change classification

Before implementation, classify each change:

- **Low risk:** isolated UI or presentation change with no data or permission impact.
- **Moderate risk:** additive schema, new workflow, new RPC or new RLS policy.
- **High risk:** changes to existing records, historical data, identity/tenant relationships, access-control boundaries or constraints.
- **Critical risk:** destructive operations, production data transformation, removal of security controls or irreversible changes.

Moderate, high and critical changes require explicit review of migration and security impact. High and critical production changes require explicit authorization and a verified recovery plan.

## 10. Non-negotiable operating rules

- Do not use destructive Git operations or overwrite uncommitted user work.
- Do not commit, push, merge into the main branch, or deploy to production without explicit approval.
- Do not apply production migrations without explicit approval.
- Never request or expose Supabase service-role keys, database passwords or other secrets in chat or source control.
- Keep secrets in the appropriate environment secret manager.
- Preserve existing modules and architecture; extend them instead of duplicating established functionality.
- Report clearly what was implemented, what was tested, what was not tested and what remains blocked.

## 11. Definition of done for a production change

A production change is complete only when:

- The implementation is reviewed.
- Required automated checks pass.
- Database changes are applied to the intended environment in the approved order.
- Existing data and historical records are verified intact.
- RLS and role-based access are verified.
- The affected user workflows pass smoke tests.
- Recovery readiness is confirmed for sensitive changes.
- The deployment result and any remaining limitations are documented.

---

**Governing principle:** The platform must be able to grow without sacrificing data continuity, historical traceability, tenant isolation or user trust.
