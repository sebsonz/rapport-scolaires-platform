-- PostgreSQL smoke test for multi-department roles and validated operation limits.
-- Executed only in the disposable CI database after applying all migrations.
insert into auth.users(id, email, raw_user_meta_data) values
 ('11111111-1111-4111-8111-111111111111','agent@example.test','{"full_name":"Agent Test"}'::jsonb),
 ('99999999-9999-4999-8999-999999999999','admin@example.test','{"full_name":"Administrateur Test"}'::jsonb);

insert into public.departments(id,code,name) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','DPT-01','Département Test 1'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','DPT-02','Département Test 2');

insert into public.schools(id,department_id,code,name) values
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','SCH-01','École Test 1'),
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','SCH-02','École Test 2');

-- The rollout migration may already have created the active 2026-2027 year.
-- Reuse its canonical ID so this smoke test works after every migration.
insert into public.school_years(code,label)
values ('2026-2027','2026-2027')
on conflict (code) do update set label = excluded.label
returning id as school_year_id \gset
create temp table smoke_context as
select :'school_year_id'::uuid as school_year_id;

insert into public.promotions(id,code,label,cycle) values
 ('ffffffff-ffff-4fff-8fff-ffffffffffff','4EME','4ème','1er');

insert into public.pedagogical_groups(id,school_id,school_year_id,promotion_id,group_code) values
 ('12121212-1212-4121-8121-121212121212','cccccccc-cccc-4ccc-8ccc-cccccccccccc',:'school_year_id','ffffffff-ffff-4fff-8fff-ffffffffffff','4E-I'),
 ('13131313-1313-4131-8131-131313131313','dddddddd-dddd-4ddd-8ddd-dddddddddddd',:'school_year_id','ffffffff-ffff-4fff-8fff-ffffffffffff','4E-II');

insert into public.school_memberships(user_id,department_id,role) values
 ('99999999-9999-4999-8999-999999999999',null,'CENTRAL_ADMIN');

select set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999999',false);
select public.assign_department_role('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','CATEGORY_1');
select public.assign_department_role('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','CATEGORY_2');
select public.assign_department_role('11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','CATEGORY_2');

-- The same user has two categories in one department and a different category in another.
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
select public.save_school_report(
 '12121212-1212-4121-8121-121212121212',
 '{"A":"4EME","B":"4ème I","C":72,"D":58,"F":0}'::jsonb
);

select public.record_school_report_operation(
 '12121212-1212-4121-8121-121212121212','ENROLLMENT_RATISSAGE',12,
 '21212121-2121-4212-8212-212121212121','Premier ratissage'
);
select public.record_school_report_operation(
 '12121212-1212-4121-8121-121212121212','ENROLLMENT_RATISSAGE',2,
 '22222222-2222-4222-8222-222222222222','Deuxième ratissage'
);
select public.record_school_report_operation(
 '12121212-1212-4121-8121-121212121212','ENROLLMENT_CORRECTION',3,
 '23232323-2323-4232-8232-232323232323','Corrections de dossiers'
);

do $$
begin
  begin
    perform public.record_school_report_operation(
      '12121212-1212-4121-8121-121212121212','ENROLLMENT_RATISSAGE',1,
      '24242424-2424-4242-8242-242424242424','Doit dépasser la capacité'
    );
    raise exception 'Le ratissage au-delà de la capacité aurait dû être refusé';
  exception when others then
    if sqlerrm = 'Le ratissage au-delà de la capacité aurait dû être refusé' then raise; end if;
  end;
end $$;

select public.record_school_report_operation(
 '12121212-1212-4121-8121-121212121212','DELIVERY_INITIAL',60,
 '31313131-3131-4131-8131-313131313131','Livraison initiale'
);
select public.record_school_report_operation(
 '12121212-1212-4121-8121-121212121212','DELIVERY_RATISSAGE',10,
 '32323232-3232-4232-8232-323232323232','Livraison ratissage'
);
select public.record_school_report_operation(
 '12121212-1212-4121-8121-121212121212','DELIVERY_CORRECTION_FIRST_ISSUE',2,
 '33333333-3333-4333-8333-333333333333','Première remise après correction'
);
select public.record_school_report_operation(
 '12121212-1212-4121-8121-121212121212','DELIVERY_REPRINT',3,
 '34343434-3434-4343-8343-343434343434','Réimpressions hors total unique'
);

do $$
begin
  begin
    perform public.record_school_report_operation(
      '12121212-1212-4121-8121-121212121212','DELIVERY_INITIAL',1,
      '35353535-3535-4353-8353-353535353535','Doit dépasser les enrôlés'
    );
    raise exception 'La livraison au-delà des enrôlés aurait dû être refusée';
  exception when others then
    if sqlerrm = 'La livraison au-delà des enrôlés aurait dû être refusée' then raise; end if;
  end;
end $$;

do $$
declare v_row record;
begin
  select * into v_row
  from public.get_department_situations((select school_year_id from pg_temp.smoke_context))
  where department_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  if v_row.total_effectif<>72 or v_row.total_enrolled<>72 or v_row.enrollment_corrections<>3 then
    raise exception 'Agrégats enrôlement incorrects: %',row_to_json(v_row);
  end if;
  if v_row.total_delivered_unique<>72 or v_row.delivery_reprints<>3 or v_row.delivery_remaining<>0 then
    raise exception 'Agrégats livraison incorrects: %',row_to_json(v_row);
  end if;
  if v_row.enrollment_rate<>100 or v_row.delivery_rate<>100 or v_row.anomaly_count<>0 then
    raise exception 'Taux ou anomalies incorrects: %',row_to_json(v_row);
  end if;
  if (select count(*) from public.get_department_situations((select school_year_id from pg_temp.smoke_context)))<>2 then
    raise exception 'La situation ne retourne pas les deux départements autorisés';
  end if;
end $$;
