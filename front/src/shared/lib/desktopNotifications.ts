import { getEntityType } from './entityId';
import { useWorkspaceStore } from '../model/workspace.store';

// T-context (2026-08-25, owner's ask: "пуш уведомления в браузере, не
// APN/GCM а человеческие"): deliberately just the plain Web Notification
// API -- no Service Worker, no VAPID keys, no push subscription. Fires only
// while a Marrow tab is open and connected to the realtime WS subscription
// (RealtimeProvider), same trigger scope as the existing Telegram
// notifications (an event whose targetUserIds includes the current user).
const STORAGE_KEY = 'marrow_desktop_notifications_enabled';

export interface GatewayEventNotifyPayload {
  id?: unknown;
  title?: unknown;
  body?: unknown;
  relatedId?: unknown;
  targetUserIds?: unknown;
}

export function isDesktopNotificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getDesktopNotificationsPermission(): NotificationPermission | 'unsupported' {
  if (!isDesktopNotificationsSupported()) return 'unsupported';
  return Notification.permission;
}

export function getDesktopNotificationsEnabled(): boolean {
  if (!isDesktopNotificationsSupported()) return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === '1' && Notification.permission === 'granted';
  } catch {
    return false;
  }
}

export async function enableDesktopNotifications(): Promise<NotificationPermission> {
  if (!isDesktopNotificationsSupported()) return 'denied';
  const permission = await Notification.requestPermission();
  if (permission === 'granted') {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // localStorage can throw in a private/locked-down context -- the
      // toggle just won't survive a reload, not worth surfacing an error for.
    }
  }
  return permission;
}

export function disableDesktopNotifications(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // see enableDesktopNotifications
  }
}

// Called from RealtimeProvider for every incoming gatewayEvents WS message.
// Mirrors notifyTelegram's own trigger condition exactly (base.ts's
// recordEventForProject: iterate the event's targetUserIds) -- the payload
// already carries targetUserIds/title/body/relatedId in full, no extra
// query needed.
export function notifyIfTargeted(payload: unknown, currentUserId: string | null | undefined): void {
  if (!currentUserId || !getDesktopNotificationsEnabled()) return;
  const p = payload as GatewayEventNotifyPayload;
  const targetUserIds = Array.isArray(p.targetUserIds) ? (p.targetUserIds as unknown[]) : [];
  if (!targetUserIds.includes(currentUserId)) return;

  // Skip while the user is actively looking at this very tab -- the in-app
  // "Assigned to you" badge (Notifications page) already covers that case;
  // a desktop popup on top would just be redundant/annoying.
  if (typeof document !== 'undefined' && document.visibilityState === 'visible' && document.hasFocus()) {
    return;
  }

  const title = typeof p.title === 'string' && p.title ? p.title : 'Marrow';
  const body = typeof p.body === 'string' ? p.body : undefined;
  const relatedId = typeof p.relatedId === 'string' ? p.relatedId : null;
  const tag = typeof p.id === 'string' ? p.id : undefined;

  try {
    const n = new Notification(title, { body, tag });
    n.onclick = () => {
      window.focus();
      if (relatedId) {
        useWorkspaceStore.getState().setSelectedRecord(relatedId, getEntityType(relatedId));
      }
      n.close();
    };
  } catch {
    // Best-effort side effect -- a notification failing must never break
    // the realtime event handling it's attached to.
  }
}
