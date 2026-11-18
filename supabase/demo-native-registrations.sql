-- Local demo data for the native registration workflows.
-- Safe to run repeatedly: all records use deterministic IDs and are upserted.

begin;

-- Give the three demo lecturers access to the Y co so room type.
update public.profiles
set allow_basic_medical_access = true,
    phone = case id
      when 'c18c4f94-a58a-4b5f-abd0-8c4856affab8'::uuid then '0901000001'
      when 'e2ce1c09-18c1-4139-b80a-d08b5ce6ab8a'::uuid then '0901000002'
      when 'fc072ca9-e5e0-4b06-b5a8-5d863273992d'::uuid then '0901000003'
      else phone
    end
where id in (
  'c18c4f94-a58a-4b5f-abd0-8c4856affab8',
  'e2ce1c09-18c1-4139-b80a-d08b5ce6ab8a',
  'fc072ca9-e5e0-4b06-b5a8-5d863273992d'
);

insert into public.profile_room_types (profile_id, room_type_id, created_by)
values
  ('c18c4f94-a58a-4b5f-abd0-8c4856affab8', '40000000-0000-0000-0000-000000000002', 'c18c4f94-a58a-4b5f-abd0-8c4856affab8'),
  ('e2ce1c09-18c1-4139-b80a-d08b5ce6ab8a', '40000000-0000-0000-0000-000000000002', 'c18c4f94-a58a-4b5f-abd0-8c4856affab8'),
  ('fc072ca9-e5e0-4b06-b5a8-5d863273992d', '40000000-0000-0000-0000-000000000002', 'c18c4f94-a58a-4b5f-abd0-8c4856affab8')
on conflict (profile_id, room_type_id) do nothing;

insert into public.rooms (
  id, room_code, building_code, room_name, capacity, is_active, room_type_id
)
values
  ('20000000-0000-0000-0000-000000000006', 'YCS-01', 'B10', 'Phòng thực hành Y cơ sở 01', 40, true, '40000000-0000-0000-0000-000000000002'),
  ('20000000-0000-0000-0000-000000000007', 'YCS-02', 'B10', 'Phòng thực hành Y cơ sở 02', 36, true, '40000000-0000-0000-0000-000000000002')
on conflict (id) do update set
  room_code = excluded.room_code,
  building_code = excluded.building_code,
  room_name = excluded.room_name,
  capacity = excluded.capacity,
  is_active = excluded.is_active,
  room_type_id = excluded.room_type_id;

insert into public.equipment_catalog (
  id, item_name, commercial_name, item_type, country_of_origin, manufacturer, model, unit, is_active
)
values
  ('60000000-0000-0000-0000-000000000001', '[Mock] Máy đo huyết áp điện tử', 'Omron HEM-7120', 'Thiết bị', 'Nhật Bản', 'Omron', 'HEM-7120', 'Máy', true),
  ('60000000-0000-0000-0000-000000000002', '[Mock] Ống nghe hai mặt', 'Littmann Classic III', 'Thiết bị', 'Hoa Kỳ', '3M', 'Classic III', 'Cái', true),
  ('60000000-0000-0000-0000-000000000003', '[Mock] Bộ tiêm truyền tĩnh mạch', 'IV Practice Kit', 'Vật tư', 'Việt Nam', 'Medlabs', 'IV-KIT-01', 'Bộ', true),
  ('60000000-0000-0000-0000-000000000004', '[Mock] Găng tay y tế', 'Nitrile Examination Gloves', 'Vật tư tiêu hao', 'Malaysia', 'Top Glove', 'NG-100', 'Hộp', true),
  ('60000000-0000-0000-0000-000000000005', '[Mock] Mô hình hồi sức tim phổi', 'Little Anne QCPR', 'Mô hình', 'Na Uy', 'Laerdal', 'QCPR-LA', 'Bộ', true)
on conflict (id) do update set
  item_name = excluded.item_name,
  commercial_name = excluded.commercial_name,
  item_type = excluded.item_type,
  country_of_origin = excluded.country_of_origin,
  manufacturer = excluded.manufacturer,
  model = excluded.model,
  unit = excluded.unit,
  is_active = excluded.is_active;

-- Five Y co so forms. A is the registrant, B is responsible, while the
-- teaching lecturer alternates between A, B and another scoped lecturer C.
insert into public.basic_medical_registrations (
  id, academic_year, semester, start_date, end_date, course_id, room_id,
  student_count, registrant_id, responsible_lecturer_id, note, created_by
)
values
  ('51000000-0000-0000-0000-000000000001', '2026-2027', 'HK1', '2026-08-10', '2026-08-10', '10000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000006', 28, 'c18c4f94-a58a-4b5f-abd0-8c4856affab8', 'e2ce1c09-18c1-4139-b80a-d08b5ce6ab8a', '[MOCK LOCAL] Phiếu Y cơ sở 1 - giảng viên dạy là A', 'c18c4f94-a58a-4b5f-abd0-8c4856affab8'),
  ('51000000-0000-0000-0000-000000000002', '2026-2027', 'HK1', '2026-08-11', '2026-08-11', '10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000007', 32, 'c18c4f94-a58a-4b5f-abd0-8c4856affab8', 'e2ce1c09-18c1-4139-b80a-d08b5ce6ab8a', '[MOCK LOCAL] Phiếu Y cơ sở 2 - giảng viên dạy là B', 'c18c4f94-a58a-4b5f-abd0-8c4856affab8'),
  ('51000000-0000-0000-0000-000000000003', '2026-2027', 'HK1', '2026-08-12', '2026-08-12', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000006', 24, 'c18c4f94-a58a-4b5f-abd0-8c4856affab8', 'e2ce1c09-18c1-4139-b80a-d08b5ce6ab8a', '[MOCK LOCAL] Phiếu Y cơ sở 3 - giảng viên dạy là C', 'c18c4f94-a58a-4b5f-abd0-8c4856affab8'),
  ('51000000-0000-0000-0000-000000000004', '2026-2027', 'HK1', '2026-08-13', '2026-08-13', '10000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000007', 30, 'c18c4f94-a58a-4b5f-abd0-8c4856affab8', 'e2ce1c09-18c1-4139-b80a-d08b5ce6ab8a', '[MOCK LOCAL] Phiếu Y cơ sở 4 - giảng viên dạy là A', 'c18c4f94-a58a-4b5f-abd0-8c4856affab8'),
  ('51000000-0000-0000-0000-000000000005', '2026-2027', 'HK1', '2026-08-14', '2026-08-14', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000006', 26, 'c18c4f94-a58a-4b5f-abd0-8c4856affab8', 'e2ce1c09-18c1-4139-b80a-d08b5ce6ab8a', '[MOCK LOCAL] Phiếu Y cơ sở 5 - giảng viên dạy là C', 'c18c4f94-a58a-4b5f-abd0-8c4856affab8')
on conflict (id) do update set
  academic_year = excluded.academic_year,
  semester = excluded.semester,
  start_date = excluded.start_date,
  end_date = excluded.end_date,
  course_id = excluded.course_id,
  room_id = excluded.room_id,
  student_count = excluded.student_count,
  registrant_id = excluded.registrant_id,
  responsible_lecturer_id = excluded.responsible_lecturer_id,
  note = excluded.note,
  created_by = excluded.created_by;

insert into public.class_schedules (
  id, course_id, course_code_snapshot, course_name_snapshot, room_id, lecturer_id,
  class_code, schedule_date, start_time, end_time, source, schedule_status, note,
  student_count, created_by, published_by, published_at, basic_medical_registration_id
)
values
  ('52000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000005', 'MED 120', 'Giải phẫu sinh lý', '20000000-0000-0000-0000-000000000006', 'c18c4f94-a58a-4b5f-abd0-8c4856affab8', 'YCS-MOCK-01', '2026-08-10', '07:30', '09:30', 'manual', 'published', '[MOCK LOCAL] Buổi Y cơ sở 1', 28, 'c18c4f94-a58a-4b5f-abd0-8c4856affab8', 'c18c4f94-a58a-4b5f-abd0-8c4856affab8', now(), '51000000-0000-0000-0000-000000000001'),
  ('52000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003', 'PHA 110', 'Dược lý cơ bản', '20000000-0000-0000-0000-000000000007', 'e2ce1c09-18c1-4139-b80a-d08b5ce6ab8a', 'YCS-MOCK-02', '2026-08-11', '07:30', '09:30', 'manual', 'published', '[MOCK LOCAL] Buổi Y cơ sở 2', 32, 'c18c4f94-a58a-4b5f-abd0-8c4856affab8', 'c18c4f94-a58a-4b5f-abd0-8c4856affab8', now(), '51000000-0000-0000-0000-000000000002'),
  ('52000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'NUR 101', 'Thăm khám thể chất', '20000000-0000-0000-0000-000000000006', 'fc072ca9-e5e0-4b06-b5a8-5d863273992d', 'YCS-MOCK-03', '2026-08-12', '07:30', '09:30', 'manual', 'published', '[MOCK LOCAL] Buổi Y cơ sở 3', 24, 'c18c4f94-a58a-4b5f-abd0-8c4856affab8', 'c18c4f94-a58a-4b5f-abd0-8c4856affab8', now(), '51000000-0000-0000-0000-000000000003'),
  ('52000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000004', 'NUR 230', 'Chăm sóc người cao tuổi', '20000000-0000-0000-0000-000000000007', 'c18c4f94-a58a-4b5f-abd0-8c4856affab8', 'YCS-MOCK-04', '2026-08-13', '07:30', '09:30', 'manual', 'published', '[MOCK LOCAL] Buổi Y cơ sở 4', 30, 'c18c4f94-a58a-4b5f-abd0-8c4856affab8', 'c18c4f94-a58a-4b5f-abd0-8c4856affab8', now(), '51000000-0000-0000-0000-000000000004'),
  ('52000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000002', 'NUR 205', 'Điều dưỡng nội khoa', '20000000-0000-0000-0000-000000000006', 'fc072ca9-e5e0-4b06-b5a8-5d863273992d', 'YCS-MOCK-05', '2026-08-14', '07:30', '09:30', 'manual', 'published', '[MOCK LOCAL] Buổi Y cơ sở 5', 26, 'c18c4f94-a58a-4b5f-abd0-8c4856affab8', 'c18c4f94-a58a-4b5f-abd0-8c4856affab8', now(), '51000000-0000-0000-0000-000000000005')
on conflict (id) do update set
  course_id = excluded.course_id,
  course_code_snapshot = excluded.course_code_snapshot,
  course_name_snapshot = excluded.course_name_snapshot,
  room_id = excluded.room_id,
  lecturer_id = excluded.lecturer_id,
  class_code = excluded.class_code,
  schedule_date = excluded.schedule_date,
  start_time = excluded.start_time,
  end_time = excluded.end_time,
  source = excluded.source,
  schedule_status = excluded.schedule_status,
  note = excluded.note,
  student_count = excluded.student_count,
  published_by = excluded.published_by,
  published_at = excluded.published_at,
  basic_medical_registration_id = excluded.basic_medical_registration_id;

insert into public.basic_medical_registration_sessions (
  id, registration_id, class_schedule_id, lesson_title, teaching_lecturer_id, session_number
)
values
  ('53000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', '52000000-0000-0000-0000-000000000001', '[Mock] Thực hành khám tổng quát', 'c18c4f94-a58a-4b5f-abd0-8c4856affab8', 1),
  ('53000000-0000-0000-0000-000000000002', '51000000-0000-0000-0000-000000000002', '52000000-0000-0000-0000-000000000002', '[Mock] Thực hành sử dụng thuốc', 'e2ce1c09-18c1-4139-b80a-d08b5ce6ab8a', 1),
  ('53000000-0000-0000-0000-000000000003', '51000000-0000-0000-0000-000000000003', '52000000-0000-0000-0000-000000000003', '[Mock] Thăm khám thể chất', 'fc072ca9-e5e0-4b06-b5a8-5d863273992d', 1),
  ('53000000-0000-0000-0000-000000000004', '51000000-0000-0000-0000-000000000004', '52000000-0000-0000-0000-000000000004', '[Mock] Đánh giá người cao tuổi', 'c18c4f94-a58a-4b5f-abd0-8c4856affab8', 1),
  ('53000000-0000-0000-0000-000000000005', '51000000-0000-0000-0000-000000000005', '52000000-0000-0000-0000-000000000005', '[Mock] Chăm sóc nội khoa', 'fc072ca9-e5e0-4b06-b5a8-5d863273992d', 1)
on conflict (id) do update set
  registration_id = excluded.registration_id,
  class_schedule_id = excluded.class_schedule_id,
  lesson_title = excluded.lesson_title,
  teaching_lecturer_id = excluded.teaching_lecturer_id,
  session_number = excluded.session_number;

-- Five Skills lab classes used by the equipment registration feature.
insert into public.class_schedules (
  id, course_id, course_code_snapshot, course_name_snapshot, room_id, lecturer_id,
  class_code, schedule_date, start_time, end_time, source, schedule_status, note,
  student_count, created_by, published_by, published_at
)
values
  ('61000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'NUR 101', 'Thăm khám thể chất', '20000000-0000-0000-0000-000000000001', 'c18c4f94-a58a-4b5f-abd0-8c4856affab8', 'SKILL-MOCK-01', '2026-08-17', '12:30', '14:30', 'manual', 'published', '[MOCK LOCAL] Lớp Skill lab 1', 25, 'c18c4f94-a58a-4b5f-abd0-8c4856affab8', 'c18c4f94-a58a-4b5f-abd0-8c4856affab8', now()),
  ('61000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'NUR 205', 'Điều dưỡng nội khoa', '20000000-0000-0000-0000-000000000002', 'e2ce1c09-18c1-4139-b80a-d08b5ce6ab8a', 'SKILL-MOCK-02', '2026-08-18', '12:30', '14:30', 'manual', 'published', '[MOCK LOCAL] Lớp Skill lab 2', 30, 'c18c4f94-a58a-4b5f-abd0-8c4856affab8', 'c18c4f94-a58a-4b5f-abd0-8c4856affab8', now()),
  ('61000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000004', 'NUR 230', 'Chăm sóc người cao tuổi', '20000000-0000-0000-0000-000000000003', 'fc072ca9-e5e0-4b06-b5a8-5d863273992d', 'SKILL-MOCK-03', '2026-08-19', '12:30', '14:30', 'manual', 'published', '[MOCK LOCAL] Lớp Skill lab 3', 22, 'c18c4f94-a58a-4b5f-abd0-8c4856affab8', 'c18c4f94-a58a-4b5f-abd0-8c4856affab8', now()),
  ('61000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'NUR 101', 'Thăm khám thể chất', '20000000-0000-0000-0000-000000000004', 'c18c4f94-a58a-4b5f-abd0-8c4856affab8', 'SKILL-MOCK-04', '2026-08-20', '12:30', '14:30', 'manual', 'published', '[MOCK LOCAL] Lớp Skill lab 4', 27, 'c18c4f94-a58a-4b5f-abd0-8c4856affab8', 'c18c4f94-a58a-4b5f-abd0-8c4856affab8', now()),
  ('61000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000002', 'NUR 205', 'Điều dưỡng nội khoa', '20000000-0000-0000-0000-000000000005', 'e2ce1c09-18c1-4139-b80a-d08b5ce6ab8a', 'SKILL-MOCK-05', '2026-08-21', '12:30', '14:30', 'manual', 'published', '[MOCK LOCAL] Lớp Skill lab 5', 35, 'c18c4f94-a58a-4b5f-abd0-8c4856affab8', 'c18c4f94-a58a-4b5f-abd0-8c4856affab8', now())
on conflict (id) do update set
  course_id = excluded.course_id,
  course_code_snapshot = excluded.course_code_snapshot,
  course_name_snapshot = excluded.course_name_snapshot,
  room_id = excluded.room_id,
  lecturer_id = excluded.lecturer_id,
  class_code = excluded.class_code,
  schedule_date = excluded.schedule_date,
  start_time = excluded.start_time,
  end_time = excluded.end_time,
  source = excluded.source,
  schedule_status = excluded.schedule_status,
  note = excluded.note,
  student_count = excluded.student_count,
  published_by = excluded.published_by,
  published_at = excluded.published_at;

insert into public.equipment_requests (
  id, class_schedule_id, registrant_id, responsible_lecturer_id, phone_snapshot,
  email_snapshot, receive_at, return_at, status, note, created_by, created_at
)
values
  ('62000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000001', 'c18c4f94-a58a-4b5f-abd0-8c4856affab8', 'e2ce1c09-18c1-4139-b80a-d08b5ce6ab8a', '0901000001', 'admin@campus.local', '2026-08-17 11:30+07', '2026-08-17 15:00+07', 'new', '[MOCK LOCAL] Phiếu thiết bị mới', 'c18c4f94-a58a-4b5f-abd0-8c4856affab8', '2026-08-03 09:00:01+07'),
  ('62000000-0000-0000-0000-000000000002', '61000000-0000-0000-0000-000000000002', 'c18c4f94-a58a-4b5f-abd0-8c4856affab8', 'e2ce1c09-18c1-4139-b80a-d08b5ce6ab8a', '0901000002', 'admin@campus.local', '2026-08-18 11:30+07', '2026-08-18 15:00+07', 'preparing', '[MOCK LOCAL] Phiếu đang chuẩn bị', 'c18c4f94-a58a-4b5f-abd0-8c4856affab8', '2026-08-03 09:00:02+07'),
  ('62000000-0000-0000-0000-000000000003', '61000000-0000-0000-0000-000000000003', 'c18c4f94-a58a-4b5f-abd0-8c4856affab8', 'e2ce1c09-18c1-4139-b80a-d08b5ce6ab8a', '0901000003', 'admin@campus.local', '2026-08-19 11:30+07', '2026-08-19 15:00+07', 'handed_over', '[MOCK LOCAL] Phiếu đã giao', 'c18c4f94-a58a-4b5f-abd0-8c4856affab8', '2026-08-03 09:00:03+07'),
  ('62000000-0000-0000-0000-000000000004', '61000000-0000-0000-0000-000000000004', 'c18c4f94-a58a-4b5f-abd0-8c4856affab8', 'e2ce1c09-18c1-4139-b80a-d08b5ce6ab8a', '0901000004', 'admin@campus.local', '2026-08-20 11:30+07', '2026-08-20 15:00+07', 'returned', '[MOCK LOCAL] Phiếu đã trả', 'c18c4f94-a58a-4b5f-abd0-8c4856affab8', '2026-08-03 09:00:04+07'),
  ('62000000-0000-0000-0000-000000000005', '61000000-0000-0000-0000-000000000005', 'c18c4f94-a58a-4b5f-abd0-8c4856affab8', 'e2ce1c09-18c1-4139-b80a-d08b5ce6ab8a', '0901000005', 'admin@campus.local', '2026-08-21 11:30+07', '2026-08-21 15:00+07', 'completed', '[MOCK LOCAL] Phiếu hoàn thành', 'c18c4f94-a58a-4b5f-abd0-8c4856affab8', '2026-08-03 09:00:05+07')
on conflict (id) do update set
  class_schedule_id = excluded.class_schedule_id,
  registrant_id = excluded.registrant_id,
  responsible_lecturer_id = excluded.responsible_lecturer_id,
  phone_snapshot = excluded.phone_snapshot,
  email_snapshot = excluded.email_snapshot,
  receive_at = excluded.receive_at,
  return_at = excluded.return_at,
  status = excluded.status,
  note = excluded.note,
  created_by = excluded.created_by,
  created_at = excluded.created_at;

insert into public.equipment_request_items (
  id, request_id, skill_name, catalog_item_id, quantity, note
)
values
  ('63000000-0000-0000-0000-000000000001', '62000000-0000-0000-0000-000000000001', '[Mock] Đo dấu hiệu sinh tồn', '60000000-0000-0000-0000-000000000001', 2, 'Dùng theo nhóm'),
  ('63000000-0000-0000-0000-000000000002', '62000000-0000-0000-0000-000000000002', '[Mock] Nghe tim phổi', '60000000-0000-0000-0000-000000000002', 10, 'Mỗi nhóm hai ống nghe'),
  ('63000000-0000-0000-0000-000000000003', '62000000-0000-0000-0000-000000000003', '[Mock] Tiêm truyền tĩnh mạch', '60000000-0000-0000-0000-000000000003', 8, 'Chuẩn bị đủ bộ'),
  ('63000000-0000-0000-0000-000000000004', '62000000-0000-0000-0000-000000000004', '[Mock] Thực hành vô khuẩn', '60000000-0000-0000-0000-000000000004', 3, 'Ba hộp cỡ M'),
  ('63000000-0000-0000-0000-000000000005', '62000000-0000-0000-0000-000000000005', '[Mock] Hồi sức tim phổi', '60000000-0000-0000-0000-000000000005', 4, 'Kiểm tra pin trước giờ học')
on conflict (id) do update set
  request_id = excluded.request_id,
  skill_name = excluded.skill_name,
  catalog_item_id = excluded.catalog_item_id,
  quantity = excluded.quantity,
  note = excluded.note;

commit;
