import React from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Check, Film, LockKeyhole, MessageCircle, MoreHorizontal, VolumeX, Ban, Volume2 } from "lucide-react";
import type { Profile, SearchResult, Video } from "@nerloq/shared";
import { api, resolveMediaUrl } from "../../lib/api";

function UserTile({ profile }: { profile: Profile }): React.JSX.Element {
  return <Link className="explore-user" to={`/u/${encodeURIComponent(profile.username)}`}><div className="explore-avatar">{profile.avatarUrl ? <img src={resolveMediaUrl(profile.avatarUrl)} alt=""/> : profile.displayName.slice(0, 1).toUpperCase()}</div><span><strong>{profile.displayName}{profile.verified && <Check size={13}/>}</strong><small>@{profile.username}</small><small>{profile.followerCount.toLocaleString()} followers</small></span><ArrowUpRight size={15}/></Link>;
}

function VideoTile({ video }: { video: Video }): React.JSX.Element {
  return <Link className="explore-video" to={`/video/${encodeURIComponent(video.id)}`}><div className="explore-poster">{video.thumbnailUrl ? <img src={resolveMediaUrl(video.thumbnailUrl)} alt=""/> : <Film size={23}/>}<span>{Math.ceil(video.durationMs / 1000)}s</span></div><strong>{video.caption || "Video without a caption"}</strong><small>by @{video.creator.username} · {video.viewCount.toLocaleString()} views</small></Link>;
}

function LoadError({ error, retry }: { error: string; retry: () => void }): React.JSX.Element {
  return <div className="explore-error" role="alert"><span>{error}</span><button className="quiet-action" onClick={retry}>Try again</button></div>;
}

function hostname(value: string): string {
  try { return new URL(value).hostname; } catch { return value.replace(/^https?:\/\//, "").split("/")[0] ?? value; }
}

export function PublicProfilePage({ username }: { username: string }): React.JSX.Element {
  const [profile, setProfile] = React.useState<Profile | null>(null);
  const [videos, setVideos] = React.useState<readonly Video[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [following, setFollowing] = React.useState(false);
  const [requested, setRequested] = React.useState(false);
  const [followers, setFollowers] = React.useState(0);
  const [notice, setNotice] = React.useState("");
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [relationship, setRelationship] = React.useState<"visible" | "muted" | "blocked">("visible");

  const load = React.useCallback(async () => {
    setLoading(true); setError("");
    try {
      const result = await api.profile(username);
      setProfile(result.profile);
      setVideos(result.videos);
      setFollowing(result.profile.followStatus === "following");
      setRequested(result.profile.followStatus === "requested");
      setFollowers(result.profile.followerCount);
      if (result.profile.followStatus === "blocked" || result.profile.followStatus === "blocked_by") setRelationship("blocked");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Profile could not be loaded.");
    } finally { setLoading(false); }
  }, [username]);

  React.useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);

  async function toggleFollow() {
    if (!profile) return;
    setBusy(true);
    try {
      const result = await api.follow(profile.id, !(following || requested));
      setFollowing(result.following); setRequested(result.requested); setFollowers(result.followerCount);
      setNotice(result.requested ? "Follow request sent." : result.following ? "You are now following this creator." : "You stopped following this creator.");
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "Follow could not be updated."); }
    finally { setBusy(false); }
  }

  async function mute() {
    if (!profile) return;
    setBusy(true);
    try { await api.mute(profile.id); setRelationship("muted"); setMenuOpen(false); setNotice("Creator muted. You can undo this in Settings."); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : "Creator could not be muted."); }
    finally { setBusy(false); }
  }

  async function block() {
    if (!profile || !window.confirm(`Block @${profile.username}? You will no longer see their content or interactions.`)) return;
    setBusy(true);
    try { await api.block(profile.id, true); setRelationship("blocked"); setMenuOpen(false); setNotice("Creator blocked. Manage blocked accounts in Settings."); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : "Creator could not be blocked."); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="feed-state"><div className="feed-loader"/><span>Opening creator profile…</span></div>;
  if (error) return <LoadError error={error} retry={() => void load()}/>;
  if (!profile) return <div className="feed-state">This profile is unavailable.</div>;
  if (relationship === "blocked") return <section className="content-empty relationship-closed"><Ban size={22}/><h2>@{profile.username} is blocked.</h2><p>You will not see this creator’s videos or activity.</p>{notice && <p className="inline-note" role="status">{notice}</p>}</section>;

  return <div className="public-profile"><section className="public-profile-card"><div className="public-profile-avatar">{profile.avatarUrl ? <img src={resolveMediaUrl(profile.avatarUrl)} alt=""/> : profile.displayName.slice(0, 1).toUpperCase()}</div><div className="public-profile-details"><span className="eyebrow">CREATOR PROFILE</span><h2>{profile.displayName}{profile.verified && <Check size={17}/>}</h2><span className="profile-username">@{profile.username}</span><p>{profile.bio || "Sharing a point of view on NERLOQ."}</p>{profile.websiteUrl && <a className="profile-website" href={profile.websiteUrl} target="_blank" rel="noreferrer">{hostname(profile.websiteUrl)}<ArrowUpRight size={13}/></a>}</div><div className="profile-follow-cta">{!profile.isOwnProfile && <><button className={following || requested ? "quiet-action" : "primary-action"} onClick={() => void toggleFollow()} disabled={busy}>{busy ? "Updating…" : following ? "Following" : requested ? "Requested" : "Follow creator"}</button><Link className="quiet-action" to={`/inbox?to=${encodeURIComponent(profile.id)}&username=${encodeURIComponent(`@${profile.username}`)}`}><MessageCircle size={15}/> Message</Link><div className="profile-more-wrap"><button className="icon-button" onClick={() => setMenuOpen(value => !value)} aria-label="More creator options" aria-expanded={menuOpen}><MoreHorizontal size={18}/></button>{menuOpen && <div className="profile-more-menu"><button onClick={() => void mute()} disabled={busy}><VolumeX size={14}/> Mute creator</button><button onClick={() => void block()} disabled={busy}><Ban size={14}/> Block creator</button></div>}</div></>}</div><div className="public-profile-stats"><div><strong>{followers.toLocaleString()}</strong><span>Followers</span></div><div><strong>{profile.followingCount.toLocaleString()}</strong><span>Following</span></div><div><strong>{videos.length >= 30 ? `${profile.videoCount.toLocaleString()}+` : videos.length.toLocaleString()}</strong><span>Videos</span></div></div>{profile.isPrivate && <div className="private-profile-note"><LockKeyhole size={15}/>{profile.isOwnProfile ? "Your profile is private." : "Private profile · Follow to see this creator’s videos."}</div>}{relationship === "muted" && <div className="private-profile-note"><Volume2 size={15}/>You muted this creator. Their content is hidden from your feeds.</div>}{notice && <p className="inline-note" role="status">{notice}</p>}</section><div className="explore-section-heading"><div><span className="eyebrow">THEIR WORK</span><h2>Videos</h2></div></div>{videos.length ? <div className="explore-video-grid">{videos.map(video => <VideoTile key={video.id} video={video}/>)}</div> : <div className="content-empty"><Film size={17}/><span>{profile.isPrivate && !profile.isOwnProfile && !following ? "Follow this creator to see their videos." : "No videos are available to view here."}</span></div>}</div>;
}

export function SearchResultsPage({ query, type = "all" }: { query: string; type?: "all" | "creators" | "videos" | "hashtags" }): React.JSX.Element {
  const [result, setResult] = React.useState<SearchResult | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const load = React.useCallback(async () => {
    if (query.trim().length < 2) { setResult(null); setError("Enter at least two characters to search NERLOQ."); return; }
    setLoading(true); setError("");
    try { setResult(await api.search(query, type)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Search could not be completed."); }
    finally { setLoading(false); }
  }, [query, type]);
  React.useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  if (loading) return <div className="feed-state"><div className="feed-loader"/><span>Searching NERLOQ…</span></div>;
  if (error) return <LoadError error={error} retry={() => void load()}/>;
  if (!result) return <div className="feed-state">Search for a creator, video or topic.</div>;
  const resultCount = result.users.length + result.videos.length + result.hashtags.length + result.sounds.length;
  const empty = resultCount === 0;
  return <div className="search-results"><div className="explore-section-heading"><div><span className="eyebrow">SEARCH RESULTS</span><h2>“{result.query}”</h2></div><span>{resultCount} {resultCount === 1 ? "result" : "results"}</span></div>{empty ? <div className="content-empty"><Film size={17}/><span>No people, videos or hashtags matched that search.</span></div> : <>{result.users.length > 0 && <section className="explore-section"><div className="explore-section-heading"><h3>Creators</h3></div><div className="explore-user-list">{result.users.map(user => <UserTile key={user.id} profile={user}/>)}</div></section>}{result.hashtags.length > 0 && <section className="explore-section"><div className="explore-section-heading"><h3>Hashtags</h3></div><div className="hashtag-results">{result.hashtags.map(item => <Link to={`/tag/${encodeURIComponent(item.tag)}`} key={item.tag}>#{item.tag}<ArrowUpRight size={14}/></Link>)}</div></section>}{result.videos.length > 0 && <section className="explore-section"><div className="explore-section-heading"><h3>Videos</h3></div><div className="explore-video-grid">{result.videos.map(video => <VideoTile key={video.id} video={video}/>)}</div></section>}{result.sounds.length > 0 && <section className="explore-section"><div className="explore-section-heading"><h3>Sounds</h3><span>Referenced in search results</span></div><div className="sound-results">{result.sounds.map(sound => <div className="sound-result" key={sound.id}><span className="sound-disc">♪</span><span><strong>{sound.title}</strong><small>{sound.artistName} · {sound.usageCount.toLocaleString()} uses</small></span></div>)}</div></section>}</>}</div>;
}

export function HashtagPage({ tag }: { tag: string }): React.JSX.Element {
  const [videos, setVideos] = React.useState<readonly Video[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const load = React.useCallback(async () => {
    setLoading(true); setError("");
    try { const result = await api.hashtagFeed(tag); setVideos(result.items); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Hashtag videos could not be loaded."); }
    finally { setLoading(false); }
  }, [tag]);
  React.useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  if (loading) return <div className="feed-state"><div className="feed-loader"/><span>Finding #{tag} videos…</span></div>;
  if (error) return <LoadError error={error} retry={() => void load()}/>;
  return <div className="hashtag-page"><div className="hashtag-banner"><span className="eyebrow">COMMUNITY TOPIC</span><h2><span>#</span>{tag}</h2><p>Videos shared with this hashtag.</p></div>{videos.length ? <div className="explore-video-grid">{videos.map(video => <VideoTile key={video.id} video={video}/>)}</div> : <div className="content-empty"><Film size={17}/><span>No public videos use this hashtag yet.</span></div>}</div>;
}
