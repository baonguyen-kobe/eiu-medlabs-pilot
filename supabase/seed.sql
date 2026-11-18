insert into public.courses (id, course_code, course_name) values
  ('10000000-0000-0000-0000-000000000001', 'NUR 101', 'Thăm khám thể chất'),
  ('10000000-0000-0000-0000-000000000002', 'NUR 205', 'Điều dưỡng nội khoa'),
  ('10000000-0000-0000-0000-000000000003', 'PHA 110', 'Dược lý cơ bản'),
  ('10000000-0000-0000-0000-000000000004', 'NUR 230', 'Chăm sóc người cao tuổi'),
  ('10000000-0000-0000-0000-000000000005', 'MED 120', 'Giải phẫu sinh lý')
on conflict do nothing;

insert into public.rooms (
  id, room_code, building_code, room_name, capacity
) values
  ('20000000-0000-0000-0000-000000000001', '105', 'B5', 'Skills Lab 1', 30),
  ('20000000-0000-0000-0000-000000000002', '201', 'A2', 'Phòng học 201', 60),
  ('20000000-0000-0000-0000-000000000003', 'LAB-3', 'C1', 'Simulation Lab', 24),
  ('20000000-0000-0000-0000-000000000004', '302', 'B3', 'Phòng học 302', 48),
  ('20000000-0000-0000-0000-000000000005', 'LAB-5', 'D1', 'Clinical Practice Lab', 20)
on conflict do nothing;
