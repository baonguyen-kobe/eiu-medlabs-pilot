"use client";

import { Bell } from "@/components/icons";
import {
  markNotificationBeforeNavigation,
  notificationBadgeText,
} from "@/lib/notification-bell-state";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/components/i18n/language-provider";

type UserNotification = {
  id: string;
  title: string;
  body: string;
  href: string | null;
  read_at: string | null;
  created_at: string;
};

function formatRelativeTime(
  value: string,
  text: (source: string, values?: readonly unknown[]) => string,
) {
  const elapsed = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(elapsed / 60_000));
  if (minutes < 1) return text("Vừa xong");
  if (minutes < 60) return text("{0} phút trước", [minutes]);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return text("{0} giờ trước", [hours]);
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date(value));
}

export function NotificationBell() {
  const { text: uiText } = useLanguage();

  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const supabase = createClient();
    let active = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function refreshNotifications() {
      const [{ data }, { count }] = await Promise.all([
        supabase
          .from("user_notifications")
          .select("id,title,body,href,read_at,created_at")
          .order("created_at", { ascending: false })
          .limit(30),
        supabase
          .from("user_notifications")
          .select("id", { count: "exact", head: true })
          .is("read_at", null),
      ]);
      if (!active) return;
      if (data) setNotifications(data as UserNotification[]);
      if (count !== null) setUnreadCount(count);
    }

    void supabase.auth.getUser().then(({ data }) => {
      const id = data.user?.id ?? null;
      if (!active || !id) return;
      setUserId(id);
      void refreshNotifications();
      channel = supabase
        .channel(`user-notifications-${id}-${crypto.randomUUID()}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "user_notifications",
            filter: `recipient_id=eq.${id}`,
          },
          () => void refreshNotifications(),
        )
        .subscribe();
    });

    return () => {
      active = false;
      if (channel) void supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      requestAnimationFrame(() => triggerRef.current?.focus());
    }
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function markRead(id: string) {
    const supabase = createClient();
    const readAt = new Date().toISOString();
    const { data, error } = await supabase
      .from("user_notifications")
      .update({ read_at: readAt })
      .eq("id", id)
      .is("read_at", null)
      .select("id");
    if (error) return false;
    if (!data?.length) return true;
    setNotifications((current) =>
      current.map((notification) =>
        notification.id === id && !notification.read_at
          ? { ...notification, read_at: readAt }
          : notification,
      ),
    );
    setUnreadCount((current) => Math.max(0, current - 1));
    return true;
  }

  async function markAllRead() {
    if (!userId || unreadCount === 0) return;
    const readAt = new Date().toISOString();
    const supabase = createClient();
    const { error } = await supabase
      .from("user_notifications")
      .update({ read_at: readAt })
      .eq("recipient_id", userId)
      .is("read_at", null);
    if (error) return;
    setNotifications((current) =>
      current.map((notification) =>
        notification.read_at
          ? notification
          : { ...notification, read_at: readAt },
      ),
    );
    setUnreadCount(0);
  }

  return (
    <div className="notification-bell" ref={containerRef}>
      <button
        aria-controls="notification-popover"
        aria-expanded={open}
        aria-label={
          unreadCount
            ? uiText("Thông báo, {0} chưa đọc", [unreadCount])
            : uiText("Thông báo")
        }
        className="icon-button notification-bell-trigger"
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
        type="button"
      >
        <Bell size={20} />
        {notificationBadgeText(unreadCount) ? (
          <span className="notification-badge" aria-hidden="true">
            {notificationBadgeText(unreadCount)}
          </span>
        ) : null}
      </button>
      {open ? (
        <section
          aria-label={uiText("Thông báo")}
          className="notification-popover"
          id="notification-popover"
        >
          <div className="notification-popover-header">
            <strong>{uiText("Thông báo")}</strong>
            <button
              className="button button-secondary notification-read-all"
              disabled={!unreadCount}
              onClick={() => void markAllRead()}
              type="button"
            >
              {uiText("Đánh dấu tất cả đã đọc")}
            </button>
          </div>
          <div className="notification-list">
            {notifications.length ? (
              notifications.map((notification) => (
                <button
                  className={`notification-item${notification.read_at ? "" : " unread"}`}
                  key={notification.id}
                  onClick={async () => {
                    await markNotificationBeforeNavigation({
                      markRead: () => markRead(notification.id),
                      close: () => setOpen(false),
                      navigate: notification.href
                        ? () => router.push(notification.href!)
                        : undefined,
                    });
                  }}
                  type="button"
                >
                  <strong>{notification.title}</strong>
                  <span>{notification.body}</span>
                  <small>
                    {formatRelativeTime(notification.created_at, uiText)}
                  </small>
                </button>
              ))
            ) : (
              <p className="notification-empty">
                {uiText("Chưa có thông báo.")}
              </p>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
