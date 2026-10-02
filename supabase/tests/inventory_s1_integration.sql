-- Physical transaction history cannot be rewritten, even by a privileged writer.
-- The fixture and all attempted changes roll back with this test transaction.
begin;
select plan(2);

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values (
  'e0000000-0000-0000-0000-000000000001',
  'inventory-immutability@campus.local',
  '{"full_name":"Synthetic Inventory Immutability"}',
  '{"preapproved":true}'
);
insert into public.inventory_transactions (
  id, operation, business_key, actor_id, occurred_at
) values (
  'e0000000-0000-0000-0000-000000000002', 'RECEIVE',
  'PGTAP-S1-IMMUTABLE', 'e0000000-0000-0000-0000-000000000001', now()
);

select throws_ok(
  $$ update public.inventory_transactions set reason = 'tampered'
     where id = 'e0000000-0000-0000-0000-000000000002'; $$,
  '42501', null, 'Posted transaction refuses privileged UPDATE'
);
select throws_ok(
  $$ delete from public.inventory_transactions
     where id = 'e0000000-0000-0000-0000-000000000002'; $$,
  '42501', null, 'Posted transaction refuses privileged DELETE'
);
select * from finish();
rollback;
