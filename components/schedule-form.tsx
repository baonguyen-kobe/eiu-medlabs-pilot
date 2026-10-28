"use client";

import Link from "next/link";
import { useActionState } from "react";
import { CalendarDays, Save } from "@/components/icons";
import { createScheduleDraft } from "@/app/schedule-entry/new/actions";
import { CANONICAL_SEMESTERS } from "@/lib/semesters";
import { SearchableCombobox } from "@/components/searchable-combobox";
import { TimePicker } from "@/components/time-picker";
import { useLanguage } from "@/components/i18n/language-provider";
import { LocalizedText } from "@/components/i18n/language-provider";

const initialCreateScheduleState = {
  ok: false,
  message: "",
};

type Course = {
  id: string;
  course_code: string;
  course_name: string;
};

type Room = {
  id: string;
  room_code: string;
  building_code: string;
  room_name: string | null;
};

type Lecturer = {
  id: string;
  full_name: string;
};

export function ScheduleForm({
  courses,
  rooms,
  lecturers,
  canAssignLecturer,
  defaultLecturerId,
  scope,
  returnTo,
}: {
  courses: Course[];
  rooms: Room[];
  lecturers: Lecturer[];
  canAssignLecturer: boolean;
  defaultLecturerId?: string;
  scope: "skills_lab" | "basic_medical";
  returnTo?: string;
}) {
  const { text: uiText } = useLanguage();

  const [state, formAction, pending] = useActionState(
    createScheduleDraft,
    initialCreateScheduleState,
  );

  return (
    <form className="schedule-form" action={formAction} autoComplete="off">
      <input type="hidden" name="scope" value={scope} />
      {returnTo ? (
        <input type="hidden" name="return_to" value={returnTo} />
      ) : null}
      {state.message ? (
        <p className={state.ok ? "form-success" : "form-error"} role="status">
          <LocalizedText text={state.message ?? ""} />
        </p>
      ) : null}

      <section>
        <div className="form-section-title">
          <div className="form-section-title-line">
            <span className="form-section-number">01</span>
            <h2 className="standard-section-heading">{uiText("Môn học")}</h2>
          </div>
          <p>{uiText("Chọn từ danh mục để dùng đúng mã và tên môn học.")}</p>
        </div>
        <div className="form-grid two">
          <label>
            {uiText("Môn học *")}
            <SearchableCombobox
              ariaLabel={uiText("Tìm và chọn môn học")}
              name="course_id"
              options={courses.map((course) => ({
                value: course.id,
                label: `${course.course_code} — ${course.course_name}`,
                keywords: `${course.course_code} ${course.course_name}`,
              }))}
              placeholder={uiText("Gõ mã hoặc tên môn học…")}
              required
            />
          </label>
          <label>
            {uiText("Số sinh viên *")}
            <input
              name="student_count"
              type="number"
              min="1"
              step="1"
              required
            />
          </label>
        </div>
        {canAssignLecturer ? (
          <div className="lecturer-comboboxes">
            <label>
              {uiText("Giảng viên 1")}
              <SearchableCombobox
                ariaLabel={uiText("Tìm và chọn giảng viên thứ nhất")}
                emptyLabel={uiText("Chưa chọn giảng viên")}
                name="lecturer_ids"
                defaultValue={defaultLecturerId}
                options={lecturers.map((lecturer) => ({
                  value: lecturer.id,
                  label: lecturer.full_name,
                }))}
                placeholder={uiText("Gõ tên giảng viên…")}
              />
            </label>
            <label>
              {uiText("Giảng viên 2")}
              <SearchableCombobox
                ariaLabel={uiText("Tìm và chọn giảng viên thứ hai")}
                emptyLabel={uiText("Không có giảng viên thứ hai")}
                name="lecturer_ids"
                options={lecturers.map((lecturer) => ({
                  value: lecturer.id,
                  label: lecturer.full_name,
                }))}
                placeholder={uiText("Gõ tên giảng viên…")}
              />
            </label>
          </div>
        ) : (
          <p className="field-note">
            {uiText(
              "Lịch được tạo chưa phân công giảng viên. Admin có thể phân công sau khi rà soát.",
            )}
          </p>
        )}
      </section>

      <section>
        <div className="form-section-title">
          <div className="form-section-title-line">
            <span className="form-section-number">02</span>
            <h2 className="standard-section-heading">
              {uiText("Phòng & thời gian")}
            </h2>
          </div>
          <p>
            {uiText("Database sẽ chặn trùng phòng và trùng lịch giảng viên.")}
          </p>
        </div>
        <div className="form-grid three">
          <label className="schedule-room-field">
            {uiText("Phòng *")}
            <select name="room_id" defaultValue="" required>
              <option value="" disabled>
                {uiText("Chọn phòng")}
              </option>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.room_code}.{room.building_code}
                  {room.room_name ? ` — ${room.room_name}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            {uiText("Học kỳ *")}
            <select name="semester" defaultValue="" required>
              <option value="" disabled>
                {uiText("Chọn học kỳ")}
              </option>
              {CANONICAL_SEMESTERS.map((semester) => (
                <option key={semester} value={semester}>
                  {semester}
                </option>
              ))}
            </select>
          </label>
          <label>
            {uiText("Ngày học *")}
            <span className="field-icon">
              <CalendarDays size={16} />
              <input name="schedule_date" type="date" required />
            </span>
          </label>
          <label>
            {uiText("Giờ bắt đầu *")}
            <TimePicker
              name="start_time"
              defaultValue="07:30"
              required
              ariaLabel={uiText("Giờ bắt đầu")}
            />
          </label>
          <label>
            {uiText("Giờ kết thúc *")}
            <TimePicker
              name="end_time"
              defaultValue="11:30"
              required
              ariaLabel={uiText("Giờ kết thúc")}
            />
          </label>
        </div>
      </section>

      <section>
        <div className="form-section-title">
          <div className="form-section-title-line">
            <span className="form-section-number">03</span>
            <h2 className="standard-section-heading">{uiText("Ghi chú")}</h2>
          </div>
          <p>{uiText("Thông tin nội bộ bổ sung nếu cần.")}</p>
        </div>
        <label>
          {uiText("Ghi chú")}
          <textarea
            name="note"
            rows={4}
            placeholder={uiText("Nhập ghi chú…")}
          />
        </label>
      </section>

      <footer>
        <Link
          className="button button-secondary"
          href={returnTo ?? "/dashboard"}
        >
          {uiText("Hủy")}
        </Link>
        <button
          className="button button-primary"
          type="submit"
          disabled={pending}
        >
          <Save size={16} />{" "}
          {pending ? uiText("Đang lưu…") : uiText("Tạo lịch")}
        </button>
      </footer>
    </form>
  );
}
