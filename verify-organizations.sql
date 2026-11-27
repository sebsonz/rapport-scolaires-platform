SELECT
  to_regclass('public.organizations') AS organizations,
  to_regclass('public.organization_memberships') AS organization_memberships,
  to_regclass('public.organization_membership_events') AS membership_events,
  to_regclass('public.delivery_slips') AS delivery_slips;
