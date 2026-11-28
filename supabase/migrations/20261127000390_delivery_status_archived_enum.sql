-- DELIVERY-SLIPS-05A
-- Add ARCHIVED as a standalone migration. It must commit before later migrations use it.
ALTER TYPE public.delivery_status ADD VALUE IF NOT EXISTS 'ARCHIVED';
