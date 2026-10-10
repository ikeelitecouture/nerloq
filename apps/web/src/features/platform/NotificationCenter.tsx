import React from "react";
import type { Socket } from "socket.io-client";
import { Bell, CheckCheck, Heart, MessageCircle, Repeat2, UserRound } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useNavigate } from "react-router-dom";
import { api, resolveMediaUrl, type NotificationPage } from "../../lib/api";

const icons = { like: Heart, comment: MessageCircle, reply: MessageCircle, follow: UserRound, mention: MessageCircle, repost: Repeat2, system: Bell } as const;

export function NotificationCenter({ socket }: { socket: Socket | null }): React.JSX.Element {
  const [page, setPage] = React.useState<NotificationPage | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [hasMore, setHasMore] = React.useState(false);
  const cursorRef = React.useRef<string | null>(null);
  const navigate = useNavigate();
  const load = React.useCallback(async (next = false) => {
    if (next) setLoadingMore(true); else setLoading(true);
    setError("");
    try {
      const result = await api.notifications(next ? cursorRef.current ?? undefined : undefined);
      setPage(current => next && current ? { ...result, items: [...current.items, ...result.items.filter(item => !current.items.some(existing => existing.id === item.id))] } : result);
      cursorRef.current = result.pagination.cursor;
      setHasMore(result.pagination.hasMore);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Notifications could not be loaded."); }
    finally { setLoading(false); setLoadingMore(false); }
  }, []);
  React.useEffect(() => {
    let active = true;
    const refresh = () => { if (active) void load(); };
    queueMicrotask(refresh);
    socket?.on("notification:new", refresh);
    return () => { active = false; socket?.off("notification:new", refresh); };
  }, [load, socket]);
  async function markAllRead() {
    if (!page || page.unreadCount === 0) return;
    setBusy(true); setError("");
    try { await api.markNotificationsRead(); setPage(current => current ? { ...current, unreadCount: 0, items: current.items.map(item => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })) } : current); window.dispatchEvent(new Event("nerloq:notifications-changed")); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Notifications could not be updated."); }
    finally { setBusy(false); }
  }
  async function openNotification(id: string, videoId: string | null, actorUsername: string | null) {
    const item = page?.items.find(value => value.id === id);
    if (item && !item.readAt) {
      try { await api.markNotificationsRead([id]); setPage(current => current ? { ...current, unreadCount: Math.max(0, current.unreadCount - 1), items: current.items.map(value => value.id === id ? { ...value, readAt: new Date().toISOString() } : value) } : current); window.dispatchEvent(new Event("nerloq:notifications-changed")); }
      catch { /* Navigation should still work if marking read fails. */ }
    }
    if (videoId) navigate(`/video/${encodeURIComponent(videoId)}`);
    else if (actorUsername) navigate(`/u/${encodeURIComponent(actorUsername)}`);
  }
  return <section className="notification-center" aria-label="Notifications">
    <div className="notification-toolbar"><div><span className="eyebrow">YOUR COMMUNITY</span><h2>Recent activity{page?.unreadCount ? <span className="unread-count">{page.unreadCount}</span> : null}</h2></div><div><button className="quiet-action" onClick={() => void load(false)} disabled={loading}><Bell size={15}/> Refresh</button><button className="quiet-action" onClick={() => void markAllRead()} disabled={busy || !page?.unreadCount}><CheckCheck size={15}/> Mark all read</button></div></div>
    {error && <div className="explore-error" role="alert"><span>{error}</span><button className="quiet-action" onClick={() => void load()}>Try again</button></div>}
    {loading ? <div className="comments-state">Loading your activity…</div> : page?.items.length ? <div className="notification-list">{page.items.map(item => { const Icon = icons[item.kind]; return <button type="button" className={`notification-row ${item.readAt ? "" : "unread"}`} key={item.id} onClick={() => void openNotification(item.id, item.videoId, item.actor?.username ?? null)}><span className="notification-icon">{item.actor?.avatarUrl ? <img src={resolveMediaUrl(item.actor.avatarUrl)} alt=""/> : <Icon size={17}/>}</span><span className="notification-copy">{item.actor && <strong>{item.actor.displayName} </strong>}{item.message}<small>{formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}</small></span>{!item.readAt && <i aria-label="Unread"/>}</button>; })}{hasMore && <button className="quiet-action notification-more" disabled={loadingMore} onClick={() => void load(true)}>{loadingMore ? "Loading more…" : "Load more activity"}</button>}</div> : !error ? <div className="notification-empty"><Bell size={24}/><h3>Your activity starts here.</h3><p>Likes, comments and new followers will show up as your community connects.</p></div> : null}
  </section>;
}
