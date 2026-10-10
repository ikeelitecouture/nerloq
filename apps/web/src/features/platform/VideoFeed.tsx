import React from "react";
import { Link } from "react-router-dom";
import { Bookmark, Check, Heart, MessageCircle, MoreHorizontal, Pause, Play, Repeat2, Share2, Volume2, VolumeX, X } from "lucide-react";
import type { Comment, ContentReportReason, FeedResponse, Video } from "@nerloq/shared";
import { api, ApiClientError, resolveMediaUrl } from "../../lib/api";
import { useAuth } from "../auth/AuthContext";

type FollowState = "loading" | "none" | "following" | "requested" | "blocked" | "own";

const creatorFollowCache = new Map<string, FollowState>();

function followCacheKey(viewerId: string, creatorId: string): string {
  return `${viewerId}:${creatorId}`;
}

export function VideoFeed({ type, videoId }: { readonly type: "for_you" | "following"; readonly videoId?: string }): React.JSX.Element {
  const { state } = useAuth();
  const [videos, setVideos] = React.useState<Video[]>([]);
  const cursorRef = React.useRef<string | null>(null);
  const [hasMore, setHasMore] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [error, setError] = React.useState("");
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [commentsFor, setCommentsFor] = React.useState<Video | null>(null);
  const [notice, setNotice] = React.useState("");
  const [playbackSettings, setPlaybackSettings] = React.useState({ autoplay: true, muteByDefault: true });
  const [pendingActions, setPendingActions] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    if (state.status !== "signed-in") return;
    let active = true;
    void api.settings()
      .then(settings => { if (active) setPlaybackSettings({ autoplay: settings.playback.autoplay, muteByDefault: settings.playback.muteByDefault }); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [state.status]);

  const load = React.useCallback(async (next = false) => {
    if (next) { setLoadingMore(true); setError(""); } else { setLoading(true); setError(""); }
    try {
      if (videoId) {
        const response = await api.video(videoId);
        setVideos([response.video]);
        cursorRef.current = null;
        setHasMore(false);
      } else {
        const response: FeedResponse = await api.feed(type, next ? cursorRef.current ?? undefined : undefined);
        setVideos(current => {
          if (!next) return [...response.items];
          const known = new Set(current.map(item => item.id));
          return [...current, ...response.items.filter(item => !known.has(item.id))];
        });
        cursorRef.current = response.pagination.cursor;
        setHasMore(response.pagination.hasMore);
      }
      setNotice("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The feed could not be loaded.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [type, videoId]);

  React.useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void load(false); });
    return () => { active = false; };
  }, [load]);

  React.useEffect(() => {
    if (!hasMore || loadingMore) return;
    const sentinel = document.querySelector("[data-feed-sentinel]");
    if (!sentinel) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void load(true);
    }, { rootMargin: "500px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, load]);

  async function change(videoIdToChange: string, key: "likedByViewer" | "savedByViewer" | "repostedByViewer", action: "like" | "save" | "repost") {
    if (state.status !== "signed-in") { setNotice("Sign in to interact with videos on NERLOQ."); return; }
    const video = videos.find(item => item.id === videoIdToChange);
    if (!video || pendingActions.has(`${videoIdToChange}:${action}`)) return;
    const active = !video[key];
    const pendingKey = `${videoIdToChange}:${action}`;
    setPendingActions(current => new Set(current).add(pendingKey));
    setVideos(items => items.map(item => item.id === videoIdToChange ? { ...item, [key]: active } : item));
    try {
      const result = await api.videoAction(videoIdToChange, action, active);
      const countKey = action === "like" ? "likeCount" : action === "save" ? "saveCount" : "repostCount";
      setVideos(items => items.map(item => item.id === videoIdToChange ? { ...item, [countKey]: result.count } : item));
    } catch (cause) {
      setVideos(items => items.map(item => item.id === videoIdToChange ? { ...item, [key]: !active } : item));
      setNotice(cause instanceof Error ? cause.message : "That action could not be saved.");
    } finally {
      setPendingActions(current => { const next = new Set(current); next.delete(pendingKey); return next; });
    }
  }

  if (loading && videos.length === 0) return <div className="feed-state"><div className="feed-loader"/><span>Finding your next frame…</span></div>;
  if (error && videos.length === 0) return <div className="feed-state feed-state-error"><span className="eyebrow">FEED UNAVAILABLE</span><h2>We couldn’t reach your feed.</h2><p>{error}</p><button className="primary-action" onClick={() => void load(false)}>Try again</button></div>;
  if (!loading && videos.length === 0) return <section className="feed-empty"><div className="empty-art"><div className="art-orbit orbit-a"/><div className="art-orbit orbit-b"/><div className="art-center"><Play size={26}/></div><span className="art-spark spark-a"/><span className="art-spark spark-b"/></div><span className="eyebrow">A FRESH FRAME</span><h2>{type === "following" ? "Your circle starts here." : "Your feed is finding its rhythm."}</h2><p>{type === "following" ? "Follow creators whose perspective you want in your day. Their new videos will appear here." : "There are no published videos yet. Create the first one, or return when creators share their work."}</p><div className="empty-actions"><Link className="primary-action" to="/create">Create a video</Link><Link className="quiet-action" to="/discover">Explore NERLOQ</Link></div></section>;

  const viewerId = state.status === "signed-in" ? state.user.id : "";
  return <div className="video-feed" aria-label={type === "following" ? "Following video feed" : "For you video feed"}>
    {videos.map(video => <VideoCard key={video.id} video={video} viewerId={viewerId} active={activeId === video.id} autoplay={playbackSettings.autoplay} muteByDefault={playbackSettings.muteByDefault} onActive={setActiveId} onLike={() => void change(video.id, "likedByViewer", "like")} onSave={() => void change(video.id, "savedByViewer", "save")} onRepost={() => void change(video.id, "repostedByViewer", "repost")} onComments={() => setCommentsFor(video)} onShare={shareCount => setVideos(items => items.map(item => item.id === video.id ? { ...item, shareCount } : item))} onNotice={setNotice} onMute={id => { setVideos(items => items.filter(item => item.creator.id !== id)); setNotice("Creator muted. Their videos will no longer appear in your feeds."); }} onBlock={id => { setVideos(items => items.filter(item => item.creator.id !== id)); setNotice("Creator blocked. You can manage blocked accounts in Settings."); }} />)}
    {hasMore && <div className="feed-more" data-feed-sentinel>{loadingMore ? "Loading more videos…" : error ? <button className="quiet-action" onClick={() => void load(true)}>Retry loading more</button> : ""}</div>}
    {notice && <div className="feed-toast" role="status">{notice}<button aria-label="Dismiss" onClick={() => setNotice("")}><X size={14}/></button></div>}
    {commentsFor && <CommentsDialog video={commentsFor} viewerId={viewerId} onClose={() => setCommentsFor(null)} onComment={() => setVideos(items => items.map(item => item.id === commentsFor.id ? { ...item, commentCount: item.commentCount + 1 } : item))}/>}
  </div>;
}

function VideoCard({ video, viewerId, active, autoplay, muteByDefault, onActive, onLike, onSave, onRepost, onComments, onShare, onNotice, onMute, onBlock }: { video: Video; viewerId: string; active: boolean; autoplay: boolean; muteByDefault: boolean; onActive: (id: string | null) => void; onLike: () => void; onSave: () => void; onRepost: () => void; onComments: () => void; onShare: (count: number) => void; onNotice: (message: string) => void; onMute: (creatorId: string) => void; onBlock: (creatorId: string) => void }): React.JSX.Element {
  const media = React.useRef<HTMLVideoElement>(null);
  const menu = React.useRef<HTMLDivElement>(null);
  const [muted, setMuted] = React.useState(muteByDefault);
  const [manualPlaying, setManualPlaying] = React.useState<boolean | null>(null);
  const [progress, setProgress] = React.useState(0);
  const [duration, setDuration] = React.useState(video.durationMs / 1000);
  const [followState, setFollowState] = React.useState<FollowState>(viewerId === video.creator.id ? "own" : creatorFollowCache.get(followCacheKey(viewerId, video.creator.id)) ?? "loading");
  const [followBusy, setFollowBusy] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [reportOpen, setReportOpen] = React.useState(false);
  const [blockPrompt, setBlockPrompt] = React.useState(false);
  const [mediaError, setMediaError] = React.useState(false);
  const counted = React.useRef(false);
  const paused = manualPlaying ?? !autoplay;
  const isOwn = followState === "own" || viewerId === video.creator.id;

  React.useEffect(() => {
    queueMicrotask(() => setMuted(muteByDefault));
  }, [muteByDefault]);

  React.useEffect(() => {
    let activeRequest = true;
    queueMicrotask(() => {
      if (viewerId === video.creator.id) { setFollowState("own"); return; }
      const cached = creatorFollowCache.get(followCacheKey(viewerId, video.creator.id));
      if (cached) { setFollowState(cached); return; }
      void api.profile(video.creator.username).then(profile => {
        if (!activeRequest) return;
        const next: FollowState = profile.profile.followStatus === "following" ? "following" : profile.profile.followStatus === "requested" ? "requested" : profile.profile.followStatus === "blocked" || profile.profile.followStatus === "blocked_by" ? "blocked" : "none";
        creatorFollowCache.set(followCacheKey(viewerId, video.creator.id), next);
        setFollowState(next);
      }).catch(() => { if (activeRequest) setFollowState("none"); });
    });
    return () => { activeRequest = false; };
  }, [video.creator.id, video.creator.username, viewerId]);

  React.useEffect(() => {
    const node = media.current;
    if (!node) return;
    const observer = new IntersectionObserver(entries => {
      const entry = entries[0];
      if (entry && entry.intersectionRatio >= .72) onActive(video.id);
      else if (entry && entry.intersectionRatio < .2) onActive(null);
    }, { threshold: [0, .2, .72, 1] });
    observer.observe(node);
    return () => observer.disconnect();
  }, [onActive, video.id]);

  React.useEffect(() => {
    const node = media.current;
    if (!node) return;
    node.muted = muted;
    if (active && !paused) void node.play().catch(() => setManualPlaying(false));
    else node.pause();
  }, [active, muted, paused]);

  React.useEffect(() => {
    const closeMenu = (event: PointerEvent) => { if (menu.current && !menu.current.contains(event.target as Node)) setMenuOpen(false); };
    document.addEventListener("pointerdown", closeMenu);
    return () => document.removeEventListener("pointerdown", closeMenu);
  }, []);

  function updateTime(node: HTMLVideoElement) {
    if (node.duration) setProgress(node.currentTime / node.duration * 100);
    if (!counted.current && node.currentTime >= 1) { counted.current = true; void api.recordView(video.id).catch(() => undefined); }
  }

  async function follow() {
    if (!viewerId) { onNotice("Sign in to follow creators."); return; }
    if (followState === "loading" || followState === "blocked") return;
    setFollowBusy(true);
    try {
      const activeFollow = followState !== "following" && followState !== "requested";
      const result = await api.follow(video.creator.id, activeFollow);
      const next: FollowState = result.following ? "following" : result.requested ? "requested" : "none";
      creatorFollowCache.set(followCacheKey(viewerId, video.creator.id), next);
      setFollowState(next);
    } catch (cause) {
      onNotice(cause instanceof Error ? cause.message : "Follow could not be updated.");
    } finally {
      setFollowBusy(false);
    }
  }

  async function share() {
    const shareUrl = `${window.location.origin}/video/${encodeURIComponent(video.id)}`;
    try {
      if (navigator.share) await navigator.share({ title: `Video by @${video.creator.username}`, url: shareUrl });
      else if (navigator.clipboard) { await navigator.clipboard.writeText(shareUrl); onNotice("Video link copied."); }
      else { onNotice("Copying links is not available in this browser."); return; }
      const result = await api.shareVideo(video.id);
      onShare(result.shareCount);
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) onNotice(cause instanceof Error ? cause.message : "Could not share this video.");
    }
  }

  function togglePlayback() {
    const next = paused;
    setManualPlaying(next);
    if (next) void media.current?.play().catch(() => setManualPlaying(false));
    else media.current?.pause();
  }

  async function muteCreator() {
    try { await api.mute(video.creator.id); onMute(video.creator.id); setMenuOpen(false); }
    catch (cause) { onNotice(cause instanceof Error ? cause.message : "Creator could not be muted."); }
  }

  async function blockCreator() {
    try { await api.block(video.creator.id, true); onBlock(video.creator.id); setBlockPrompt(false); setMenuOpen(false); }
    catch (cause) { onNotice(cause instanceof Error ? cause.message : "Creator could not be blocked."); }
  }

  return <article className="video-card" aria-label={`Video by ${video.creator.displayName}`}>
    <div className="video-media-wrap">
      <video ref={media} className="video-media" src={resolveMediaUrl(video.media.url)} poster={resolveMediaUrl(video.thumbnailUrl)} playsInline loop preload={active ? "auto" : "metadata"} muted={muted} onClick={togglePlayback} onLoadedMetadata={event => setDuration(event.currentTarget.duration || duration)} onTimeUpdate={event => updateTime(event.currentTarget)} onError={() => setMediaError(true)} aria-label={`Video: ${video.caption || `by ${video.creator.displayName}`}`}/>
      {mediaError && <div className="video-media-error" role="alert"><span>Video unavailable</span><button className="quiet-action" onClick={() => { setMediaError(false); media.current?.load(); }}>Try again</button></div>}
      <button className="video-play-toggle" onClick={togglePlayback} aria-label={paused ? "Play video" : "Pause video"}>{paused ? <Play size={24}/> : <Pause size={21}/>}</button>
      <div className="video-progress"><span style={{ width: `${progress}%` }}/><input type="range" min="0" max="100" step="0.1" value={progress} onChange={event => { const node = media.current; if (!node || !node.duration) return; node.currentTime = Number(event.target.value) / 100 * node.duration; setProgress(Number(event.target.value)); }} aria-label="Video progress"/></div>
      <div className="video-top-tools"><span className="feed-badge">NERLOQ / VIDEO</span><button className="video-sound" onClick={() => setMuted(value => !value)} aria-label={muted ? "Unmute video" : "Mute video"}>{muted ? <VolumeX size={17}/> : <Volume2 size={17}/>}</button></div>
      <div className="video-gradient"/>
      <div className="video-copy"><div className="video-creator-row"><Link to={`/u/${encodeURIComponent(video.creator.username)}`} className="video-avatar">{video.creator.avatarUrl ? <img src={resolveMediaUrl(video.creator.avatarUrl)} alt=""/> : video.creator.displayName.slice(0, 1).toUpperCase()}</Link><Link to={`/u/${encodeURIComponent(video.creator.username)}`} className="video-creator-name">{video.creator.displayName}{video.creator.verified && <Check size={13}/>}<small>@{video.creator.username}</small></Link>{!isOwn && <button className={`follow-chip ${followState === "following" || followState === "requested" ? "following" : ""}`} disabled={followBusy || followState === "loading" || followState === "blocked"} aria-busy={followBusy || followState === "loading"} aria-label={followState === "following" ? "Unfollow creator" : followState === "requested" ? "Cancel follow request" : "Follow creator"} onClick={() => void follow()}>{followBusy ? "…" : followState === "loading" ? "" : followState === "following" ? "Following" : followState === "requested" ? "Requested" : followState === "blocked" ? "Unavailable" : "Follow"}</button>}</div><p className="video-caption">{video.caption}</p>{video.hashtags.length > 0 && <div className="video-tags">{video.hashtags.map(tag => <Link key={tag.tag} to={`/tag/${encodeURIComponent(tag.tag)}`}>#{tag.tag}</Link>)}</div>}<div className="video-soundline"><span className="sound-disc">♪</span>{video.sound ? <a href={resolveMediaUrl(video.sound.audioUrl)} target="_blank" rel="noreferrer">{video.sound.title} · {video.sound.artistName}</a> : <span>Original sound · @{video.creator.username}</span>}</div>{video.productLinks.length > 0 && <div className="video-product-hint">{video.productLinks.map(product => <a key={product.id} href={product.url} target="_blank" rel="noreferrer">{product.title}<span>↗</span></a>)}</div>}</div>
      <div className="video-rail"><button className={video.likedByViewer ? "chosen" : ""} onClick={onLike} aria-label={video.likedByViewer ? "Unlike video" : "Like video"}><Heart size={22} fill={video.likedByViewer ? "currentColor" : "none"}/><span>{count(video.likeCount)}</span></button><button onClick={onComments} aria-label="Open comments"><MessageCircle size={22}/><span>{count(video.commentCount)}</span></button><button className={video.repostedByViewer ? "chosen" : ""} onClick={onRepost} aria-label={video.repostedByViewer ? "Undo repost" : "Repost video"}><Repeat2 size={22}/><span>{count(video.repostCount)}</span></button><button className={video.savedByViewer ? "chosen" : ""} onClick={onSave} aria-label={video.savedByViewer ? "Remove saved video" : "Save video"}><Bookmark size={21} fill={video.savedByViewer ? "currentColor" : "none"}/><span>{count(video.saveCount)}</span></button><button onClick={() => void share()} aria-label="Share video"><Share2 size={20}/><span>{count(video.shareCount)}</span></button><div className="video-menu-wrap" ref={menu}><button onClick={() => setMenuOpen(value => !value)} aria-expanded={menuOpen} aria-label="More video options"><MoreHorizontal size={21}/></button>{menuOpen && <div className="video-menu"><button onClick={() => { setReportOpen(true); setMenuOpen(false); }}>Report video</button>{!isOwn && <><button onClick={() => void muteCreator()}>Mute creator</button><button onClick={() => { setBlockPrompt(true); setMenuOpen(false); }}>Block creator</button></>}</div>}</div></div>
    </div>
    {reportOpen && <ReportDialog onClose={() => setReportOpen(false)} onSubmit={async (reason, details) => { await api.reportVideo(video.id, reason, details); onNotice("Report sent to the safety team."); setReportOpen(false); }}/>}
    {blockPrompt && <div className="confirm-backdrop" role="dialog" aria-modal="true" aria-labelledby="block-title"><section className="confirm-panel"><span className="eyebrow">SAFETY CONTROLS</span><h2 id="block-title">Block @{video.creator.username}?</h2><p>You will no longer see this creator’s videos or receive interactions from them.</p><div className="confirm-actions"><button className="quiet-action" onClick={() => setBlockPrompt(false)}>Cancel</button><button className="danger-action" onClick={() => void blockCreator()}>Block creator</button></div></section></div>}
  </article>;
}

function count(value: number): string {
  return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}m` : value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
}

const reportReasons: readonly { value: ContentReportReason; label: string }[] = [
  { value: "spam", label: "Spam or misleading content" },
  { value: "harassment", label: "Harassment or abuse" },
  { value: "hate", label: "Hate or hateful symbols" },
  { value: "violence", label: "Violence or dangerous activity" },
  { value: "sexual_content", label: "Sexual content" },
  { value: "copyright", label: "Copyright concern" },
  { value: "privacy", label: "Privacy concern" },
  { value: "other", label: "Something else" },
];

function ReportDialog({ onClose, onSubmit }: { onClose: () => void; onSubmit: (reason: ContentReportReason, details: string) => Promise<void> }): React.JSX.Element {
  const [reason, setReason] = React.useState<ContentReportReason>("spam");
  const [details, setDetails] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!details.trim()) { setError("Add a short note so the safety team has context."); return; }
    setBusy(true); setError("");
    try { await onSubmit(reason, details.trim()); } catch (cause) { setError(cause instanceof Error ? cause.message : "Report could not be sent."); } finally { setBusy(false); }
  }
  return <div className="confirm-backdrop" role="dialog" aria-modal="true" aria-labelledby="report-title"><section className="report-panel"><header><div><span className="eyebrow">SAFETY CONTROLS</span><h2 id="report-title">Report this video</h2></div><button className="icon-button" onClick={onClose} aria-label="Close report dialog"><X size={18}/></button></header><p>Reports are reviewed against NERLOQ’s community standards.</p><form onSubmit={submit}><label className="field"><span>Reason</span><span className="field-input"><select value={reason} onChange={event => setReason(event.target.value as ContentReportReason)}>{reportReasons.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></span></label><label className="field"><span>What happened?</span><span className="field-input field-textarea"><textarea value={details} onChange={event => setDetails(event.target.value)} maxLength={1000} rows={4} placeholder="Tell us what we should look at…" autoFocus required/></span></label>{error && <p className="form-error" role="alert">{error}</p>}<div className="confirm-actions"><button type="button" className="quiet-action" onClick={onClose}>Cancel</button><button type="submit" className="danger-action" disabled={busy}>{busy ? "Sending…" : "Send report"}</button></div></form></section></div>;
}

function CommentsDialog({ video, viewerId, onClose, onComment }: { video: Video; viewerId: string; onClose: () => void; onComment: () => void }): React.JSX.Element {
  const [comments, setComments] = React.useState<Comment[]>([]);
  const [text, setText] = React.useState("");
  const [replyTo, setReplyTo] = React.useState<Comment | null>(null);
  const [hasMore, setHasMore] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [removing, setRemoving] = React.useState<string | null>(null);
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const [commentsClosed, setCommentsClosed] = React.useState(false);
  const panel = React.useRef<HTMLElement>(null);
  const cursorRef = React.useRef<string | null>(null);

  const load = React.useCallback(async (next = false) => {
    if (next) setLoadingMore(true); else setLoading(true);
    setError("");
    try {
      const result = await api.comments(video.id, next ? cursorRef.current ?? undefined : undefined);
      setComments(current => next ? [...current, ...result.items.filter(item => !current.some(existing => existing.id === item.id))] : [...result.items]);
      cursorRef.current = result.pagination.cursor;
      setHasMore(result.pagination.hasMore);
    } catch (cause) {
      if (cause instanceof ApiClientError && cause.status === 403) setCommentsClosed(true);
      setError(cause instanceof Error ? cause.message : "Comments could not be loaded.");
    } finally {
      setLoading(false); setLoadingMore(false);
    }
  }, [video.id]);

  React.useEffect(() => { let active = true; queueMicrotask(() => { if (active) { void load(false); panel.current?.focus(); } }); return () => { active = false; }; }, [load]);
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!text.trim() || sending) return;
    if (!viewerId) { setError("Sign in to join the conversation."); return; }
    setSending(true); setError("");
    try {
      const result = await api.addComment(video.id, text.trim(), replyTo?.id);
      setComments(items => [...items, result.comment]);
      setText(""); setReplyTo(null); setNotice(replyTo ? "Reply added." : "Comment added."); onComment();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Comment could not be sent.");
    } finally { setSending(false); }
  }

  async function remove(comment: Comment) {
    if (!window.confirm("Remove this comment?")) return;
    setRemoving(comment.id); setError("");
    try { await api.removeComment(comment.id); setComments(items => items.filter(item => item.id !== comment.id)); setNotice("Comment removed."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Comment could not be removed."); }
    finally { setRemoving(null); }
  }

  return <div className="comments-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="comments-panel" ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="comments-title"><header><div><span className="eyebrow">THE CONVERSATION</span><h2 id="comments-title">Comments <small>{video.commentCount}</small></h2></div><button className="icon-button" onClick={onClose} aria-label="Close comments"><X size={19}/></button></header><div className="comments-list">{loading ? <div className="comments-state"><div className="feed-loader"/>Loading the conversation…</div> : error && comments.length === 0 ? <div className="comments-state"><p>{commentsClosed ? "Comments are turned off for this video." : error}</p>{!commentsClosed && <button className="quiet-action" onClick={() => void load(false)}>Try again</button>}</div> : comments.length === 0 ? <div className="comments-state">No comments yet. Start a thoughtful conversation.</div> : comments.map(comment => <article key={comment.id} className={`comment-item ${comment.parentCommentId ? "comment-reply" : ""}`}><div className="comment-avatar">{comment.author.avatarUrl ? <img src={resolveMediaUrl(comment.author.avatarUrl)} alt=""/> : comment.author.displayName.slice(0, 1).toUpperCase()}</div><div className="comment-body"><strong>{comment.author.displayName}<small> @{comment.author.username}</small></strong><p>{comment.text}</p><div className="comment-meta"><time dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleString()}</time><button type="button" onClick={() => { setReplyTo(comment); panel.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus(); }}>Reply</button>{comment.author.id === viewerId && <button type="button" disabled={removing === comment.id} onClick={() => void remove(comment)}>{removing === comment.id ? "Removing…" : "Remove"}</button>}</div></div></article>)}{hasMore && <button className="quiet-action comments-more" disabled={loadingMore} onClick={() => void load(true)}>{loadingMore ? "Loading…" : "Load more comments"}</button>}</div>{notice && <p className="inline-note comment-notice" role="status">{notice}</p>}{error && comments.length > 0 && <p className="form-error comment-error" role="alert">{error}</p>}{!commentsClosed && <form className="comment-form" onSubmit={submit}>{replyTo && <div className="replying-to">Replying to @{replyTo.author.username}<button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply"><X size={13}/></button></div>}<textarea value={text} onChange={event => setText(event.target.value)} maxLength={1000} placeholder={replyTo ? "Write a reply…" : "Add to the conversation…"} aria-label={replyTo ? "Write a reply" : "Write a comment"}/><button className="primary-action" disabled={!text.trim() || sending}>{sending ? "Sending…" : replyTo ? "Reply" : "Comment"}</button></form>}</section></div>;
}
