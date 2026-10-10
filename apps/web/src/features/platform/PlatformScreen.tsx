import React from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Activity, Bell, Compass, Film, Home, ImagePlus, Inbox, LoaderCircle, LogOut, Menu, Plus, Search, Settings, Shield, SlidersHorizontal, Upload, UserRound, Users, X } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { VideoFeed } from "./VideoFeed";
import { api } from "../../lib/api";
import { HashtagPage, PublicProfilePage, SearchResultsPage } from "./ExploreScreens";
import { StudioOverview } from "./StudioOverview";
import { InboxScreen } from "./InboxScreen";
import { NotificationCenter } from "./NotificationCenter";
import { SettingsPanel } from "./SettingsPanel";
import { useRealtime } from "./RealtimeContext";
import { createVideoCover, normalizeCoverImage } from "../../lib/video-processing";

const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
const VIDEO_EXTENSIONS = /\.(?:mp4|mov|webm)$/i;

const navigation = [
  { path: "/home", label: "For you", icon: Home },
  { path: "/following", label: "Following", icon: Users },
  { path: "/discover", label: "Discover", icon: Compass },
  { path: "/inbox", label: "Inbox", icon: Inbox },
  { path: "/notifications", label: "Activity", icon: Bell },
];
const titles: Record<string, { kicker: string; title: string; copy: string }> = {
  "/home": { kicker: "YOUR SIGNAL", title: "For you", copy: "A considered stream of new perspectives." },
  "/following": { kicker: "YOUR CIRCLE", title: "Following", copy: "The latest from creators you follow." },
  "/discover": { kicker: "THE WIDER FRAME", title: "Discover", copy: "Find voices, ideas and topics worth your time." },
  "/inbox": { kicker: "PRIVATE BY DESIGN", title: "Inbox", copy: "Conversations with your people." },
  "/notifications": { kicker: "YOUR ACTIVITY", title: "Activity", copy: "A clear view of what is happening around you." },
  "/studio": { kicker: "YOUR WORKSPACE", title: "Creator studio", copy: "Manage your publishing and understand your reach." },
  "/settings": { kicker: "YOUR CONTROLS", title: "Settings", copy: "Shape your account, privacy and experience." },
  "/create": { kicker: "MAKE SOMETHING", title: "Create", copy: "Prepare a video for your NERLOQ community." },
};

function PublicPlatformRoute({ route, profileMatch, videoMatch, hashtagMatch }: { route: string; profileMatch: RegExpExecArray | null; videoMatch: RegExpExecArray | null; hashtagMatch: RegExpExecArray | null }): React.JSX.Element {
  const [searchParams] = useSearchParams();
  const title = profileMatch ? `@${decodeURIComponent(profileMatch[1]!)}` : videoMatch ? "Video" : hashtagMatch ? `#${decodeURIComponent(hashtagMatch[1]!)}` : "Search";
  return <main className="public-route" id="main-content" tabIndex={-1}><header className="public-route-bar"><Link to="/" className="brand-lockup"><span className="brand-mark"><img src="/nerloq.png" alt="" /></span><span className="brand-name">NERLOQ</span></Link><div className="public-route-actions"><span>{title}</span><Link className="quiet-action" to="/login">Sign in</Link><Link className="primary-action" to="/join">Join NERLOQ</Link></div></header><div className="public-route-content">{profileMatch && <PublicProfilePage username={decodeURIComponent(profileMatch[1]!)} />}{videoMatch && <VideoFeed type="for_you" videoId={decodeURIComponent(videoMatch[1]!)} />}{hashtagMatch && <HashtagPage tag={decodeURIComponent(hashtagMatch[1]!)} />}{route === "/search" && <SearchResultsPage query={searchParams.get("q") ?? ""} type={(searchParams.get("type") as "all" | "creators" | "videos" | "hashtags" | null) ?? "all"}/>}</div></main>;
}

export function PlatformScreen(): React.JSX.Element {
  const { state, signOut } = useAuth();
  const realtime = useRealtime();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [query, setQuery] = React.useState("");
  const [searchType, setSearchType] = React.useState<"all"|"creators"|"videos"|"hashtags">("all");
  const [file, setFile] = React.useState<File | null>(() => (location.state as {file?: File} | null)?.file ?? null);
  const [cover, setCover] = React.useState<File | null>(null);
  const [coverBusy, setCoverBusy] = React.useState(false);
  const [coverError, setCoverError] = React.useState("");
  const [coverSource, setCoverSource] = React.useState<"custom" | null>(null);
  const [coverTime, setCoverTime] = React.useState(0.8);
  const coverGeneration = React.useRef(0);
  const [notice, setNotice] = React.useState("");
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [caption, setCaption] = React.useState("");
  const [privacy, setPrivacy] = React.useState<"public" | "followers" | "private">("public");
  const [durationMs, setDurationMs] = React.useState(0);
  const [publishing, setPublishing] = React.useState(false);
  const [uploadProgress, setUploadProgress] = React.useState(0);
  const [publishError, setPublishError] = React.useState("");
  const [publishSuccess, setPublishSuccess] = React.useState("");
  const [unreadCount, setUnreadCount] = React.useState(0);
  const [commentsAllowed, setCommentsAllowed] = React.useState(true);
  const [draftReady, setDraftReady] = React.useState(false);
  const viewerId = state.status === "signed-in" ? state.user.id : "anonymous";
  const route = location.pathname === "/" ? "/home" : location.pathname;
  const urlQuery = searchParams.get("q") ?? "";
  const urlType = searchParams.get("type");

  React.useEffect(() => {
    if (route !== "/search") return;
    queueMicrotask(() => {
      setQuery(urlQuery);
      if (urlType === "all" || urlType === "creators" || urlType === "videos" || urlType === "hashtags") setSearchType(urlType);
    });
  }, [route, urlQuery, urlType]);

  const draftKey = `nerloq:create-draft:${viewerId}`;

  React.useEffect(() => {
    if (state.status !== "signed-in") return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        const saved = window.localStorage.getItem(draftKey);
        if (saved) {
          const draft = JSON.parse(saved) as { caption?: unknown; privacy?: unknown; commentsAllowed?: unknown };
          if (typeof draft.caption === "string") setCaption(draft.caption);
          if (draft.privacy === "public" || draft.privacy === "followers" || draft.privacy === "private") setPrivacy(draft.privacy);
          if (typeof draft.commentsAllowed === "boolean") setCommentsAllowed(draft.commentsAllowed);
        }
      } catch {
        // A malformed local draft should never block the create screen.
      } finally {
        setDraftReady(true);
      }
    });
    return () => { active = false; };
  }, [draftKey, state.status]);

  React.useEffect(() => {
    if (state.status !== "signed-in" || !draftReady || route !== "/create" || publishing || publishSuccess) return;
    try {
      window.localStorage.setItem(draftKey, JSON.stringify({ caption, privacy, commentsAllowed, savedAt: new Date().toISOString() }));
    } catch {
      // Storage can be unavailable in private browsing; the in-memory editor still works.
    }
  }, [caption, commentsAllowed, draftKey, draftReady, privacy, publishSuccess, publishing, route, state.status]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        document.querySelector<HTMLInputElement>(".global-search input")?.focus();
      } else if (!editing && event.key.toLowerCase() === "n") {
        navigate("/create");
      } else if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate]);

  React.useEffect(() => {
    queueMicrotask(() => setMenuOpen(false));
  }, [route]);
  React.useEffect(() => {
    if (state.status !== "signed-in") return;
    let active = true;
    const refresh = () => { void api.notifications().then(result => { if (active) setUnreadCount(result.unreadCount); }).catch(() => undefined); };
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    const onNotification = () => refresh();
    window.addEventListener("nerloq:notifications-changed", onNotification);
    realtime?.on("notification:new", onNotification);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("nerloq:notifications-changed", onNotification); realtime?.off("notification:new", onNotification); };
  }, [state.status, realtime]);
  const profileMatch = /^\/u\/([^/]+)$/.exec(route);
  const videoMatch = /^\/video\/([^/]+)$/.exec(route);
  const hashtagMatch = /^\/tag\/([^/]+)$/.exec(route);
  const publicRoute = Boolean(profileMatch || videoMatch || hashtagMatch || route === "/search");
  const page = titles[route] ?? (profileMatch ? { kicker: "CREATOR SPACE", title: `@${decodeURIComponent(profileMatch[1]!)}`, copy: "A creator’s view of the world." } : videoMatch ? { kicker: "ON NERLOQ", title: "Video", copy: "Watch, respond and share." } : hashtagMatch ? { kicker: "COMMUNITY TOPIC", title: `#${decodeURIComponent(hashtagMatch[1]!)}`, copy: "A stream of videos around this topic." } : route === "/search" ? { kicker: "DISCOVERY", title: "Search", copy: "People and ideas across NERLOQ." } : titles["/home"]!);
  const isVideoPage = Boolean(videoMatch);
  const isFeed = route === "/home" || route === "/following" || isVideoPage;
  function chooseVideo(next: File | null) {
    coverGeneration.current += 1;
    setPublishError("");
    setPublishSuccess("");
    if (!next) { setFile(null); setCover(null); setCoverSource(null); setDurationMs(0); return; }
    if ((!next.type.startsWith("video/") && !VIDEO_EXTENSIONS.test(next.name)) || next.size > MAX_VIDEO_BYTES) {
      setFile(null);
      setCover(null);
      setCoverSource(null);
      setDurationMs(0);
      setPublishError(next.size > MAX_VIDEO_BYTES ? "Choose a video smaller than 500 MB." : "Choose an MP4, MOV or WebM video.");
      return;
    }
    setFile(next); setCover(null); setCoverSource(null); setCoverTime(0.8); setCoverError(""); setDurationMs(0);
  }
  const coverPreview = React.useMemo(() => cover ? URL.createObjectURL(cover) : null, [cover]);
  React.useEffect(() => () => { if (coverPreview) URL.revokeObjectURL(coverPreview); }, [coverPreview]);
  React.useEffect(() => {
    if (!file || coverSource === "custom") return;
    let active = true;
    const generation = ++coverGeneration.current;
    const timer = window.setTimeout(() => {
      setCoverBusy(true);
      void createVideoCover(file, coverTime).then(image => { if (active && generation === coverGeneration.current) { setCover(image); setCoverError(""); } }).catch(cause => { if (active && generation === coverGeneration.current) setCoverError(cause instanceof Error ? cause.message : "A cover image could not be created."); }).finally(() => { if (active && generation === coverGeneration.current) setCoverBusy(false); });
    }, 180);
    return () => { active = false; window.clearTimeout(timer); };
  }, [file, coverSource, coverTime]);
  React.useEffect(() => {
    if (!file || durationMs) return;
    let active = true;
    const probe = document.createElement("video");
    const url = URL.createObjectURL(file);
    probe.preload = "metadata";
    probe.onloadedmetadata = () => { if (active && Number.isFinite(probe.duration)) setDurationMs(Math.round(probe.duration * 1000)); URL.revokeObjectURL(url); };
    probe.onerror = () => { if (active) setPublishError("This video’s duration could not be read by your browser."); URL.revokeObjectURL(url); };
    probe.src = url;
    return () => { active = false; URL.revokeObjectURL(url); };
  }, [file, durationMs]);
  if (state.status === "loading") return <div className="boot-screen">Opening your NERLOQ space…</div>;
  if (state.status !== "signed-in") {
    return publicRoute ? <PublicPlatformRoute route={route} profileMatch={profileMatch} videoMatch={videoMatch} hashtagMatch={hashtagMatch}/> : <Navigate to="/login" replace />;
  }
  async function publishVideo(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || durationMs < 1) { setPublishError("Select a video that your browser can read before publishing."); return; }
    if (coverBusy) { setPublishError("Wait for the cover image to finish preparing."); return; }
    setPublishing(true); setUploadProgress(0); setPublishError(""); setPublishSuccess("");
    const form = new FormData();
    form.append("caption", caption);
    form.append("privacy", privacy);
    form.append("durationMs", String(durationMs));
    form.append("commentsAllowed", String(commentsAllowed));
    if (cover) form.append("thumbnail", cover, cover.name);
    form.append("file", file, file.name);
    try {
      await api.publishVideo(form, setUploadProgress);
      try { window.localStorage.removeItem(draftKey); } catch { /* Ignore unavailable storage. */ }
      setPublishSuccess("Your video is published. Taking you to the feed…");
      window.setTimeout(() => navigate("/home", { replace: true }), 900);
    }
    catch (cause) { setPublishError(cause instanceof Error ? cause.message : "The video could not be published."); }
    finally { setPublishing(false); }
  }
  async function leave() { await signOut(); navigate("/login", { replace: true }); }
  function submitSearch(value: string, type = searchType) { const term = value.trim(); if (term.length >= 2) navigate(`/search?q=${encodeURIComponent(term)}&type=${type}`); }

  return <div className="platform-shell">
    <aside className={`platform-sidebar ${menuOpen ? "is-open" : ""}`}>
      <div className="sidebar-head"><Link to="/home" className="brand-lockup"><span className="brand-mark"><img src="/nerloq.png" alt="" /></span><span className="brand-name">NERLOQ</span></Link><button className="icon-button sidebar-close" aria-label="Close menu" onClick={() => setMenuOpen(false)}><X size={18}/></button></div>
      <div className="sidebar-label">YOUR SPACE</div>
      <nav className="side-nav" aria-label="Main navigation">{navigation.map(({path,label,icon:Icon}) => <Link key={path} to={path} onClick={() => setMenuOpen(false)} className={`side-link ${route===path?"active":""}`} aria-current={route===path?"page":undefined}><Icon size={18}/><span>{label}</span>{path==="/notifications"&&unreadCount>0&&<i className="nav-dot" aria-label={`${unreadCount} unread notifications`}/>}</Link>)}</nav>
      <Link to="/profile" className={`side-link ${route==="/profile"?"active":""}`} aria-current={route==="/profile"?"page":undefined}><UserRound size={18}/><span>My profile</span></Link>
      <div className="sidebar-divider"/><div className="sidebar-label">CREATE</div>
      <Link to="/create" className={`side-link ${route==="/create"?"active":""}`} aria-current={route==="/create"?"page":undefined}><Plus size={18}/><span>New video</span><span className="key-hint">N</span></Link>
      <Link to="/studio" className={`side-link ${route==="/studio"?"active":""}`} aria-current={route==="/studio"?"page":undefined}><Activity size={18}/><span>Creator studio</span></Link>
      <Link to="/settings" className={`side-link ${route==="/settings"?"active":""}`} aria-current={route==="/settings"?"page":undefined}><Settings size={18}/><span>Settings</span></Link>
      <div className="sidebar-spacer"/>
      <div className="sidebar-profile"><div className="mini-avatar">{state.user.displayName.slice(0,1).toUpperCase()}</div><div className="sidebar-user"><strong>{state.user.displayName}</strong><span>@{state.user.username}</span></div><button className="icon-button" aria-label="Sign out" onClick={() => void leave()}><LogOut size={16}/></button></div>
    </aside>
    {menuOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)}/>}
    <main className="platform-main" id="main-content" tabIndex={-1}>
      <header className="platform-topbar"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMenuOpen(true)}><Menu size={20}/></button><div className="topbar-context"><span>NERLOQ /</span> {page.title}</div><label className="global-search"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")submitSearch(query);}} placeholder="Search people, videos or hashtags" aria-label="Search NERLOQ"/><kbd>⌘ K</kbd></label><Link to="/profile" className="top-avatar" aria-label="Your profile">{state.user.displayName.slice(0,1).toUpperCase()}</Link></header>
      <div className="platform-content">
        {route==="/discover" && <section className="discovery-search"><div><span className="eyebrow">SEARCH NERLOQ</span><h1>Find your next<br/><em>point of view.</em></h1><p>Search creators, videos and hashtags from one calm workspace.</p></div><div className="discovery-input"><Search size={20}/><input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")submitSearch(query);}} placeholder="Try a creator or a topic" aria-label="Search creators, videos and hashtags"/><button aria-label="Search" onClick={()=>query.trim().length>=2?submitSearch(query):setNotice("Enter at least two characters to search.")}><span>Search</span></button></div>{notice&&<div className="inline-note" role="status">{notice}</div>}<div className="discovery-categories" role="group" aria-label="Search type"><button type="button" className={`category-chip ${searchType==="all"?"selected":""}`} onClick={()=>setSearchType("all")}><Compass size={15}/> All</button><button type="button" className={`category-chip ${searchType==="creators"?"selected":""}`} onClick={()=>setSearchType("creators")}><UserRound size={15}/> Creators</button><button type="button" className={`category-chip ${searchType==="videos"?"selected":""}`} onClick={()=>setSearchType("videos")}><Film size={15}/> Videos</button><button type="button" className={`category-chip ${searchType==="hashtags"?"selected":""}`} onClick={()=>setSearchType("hashtags")}><span>#</span> Hashtags</button></div></section>}
        {!isVideoPage&&route!=="/discover"&&<div className="page-heading"><div><span className="eyebrow">{page.kicker}</span><h1>{page.title}</h1><p>{page.copy}</p></div>{(route==="/home"||route==="/following")&&<button className="filter-button" onClick={()=>navigate("/settings")}><SlidersHorizontal size={16}/> Preferences</button>}</div>}
        {isFeed&&<VideoFeed type={route==="/following"?"following":"for_you"} {...(videoMatch?{videoId:decodeURIComponent(videoMatch[1]!)}:{})}/>}
        {profileMatch&&<PublicProfilePage username={decodeURIComponent(profileMatch[1]!)} />}
        {route==="/search"&&<SearchResultsPage query={searchParams.get("q")??""} type={(searchParams.get("type") as "all"|"creators"|"videos"|"hashtags"|null)??"all"}/>}
        {hashtagMatch&&<HashtagPage tag={decodeURIComponent(hashtagMatch[1]!)} />}
        {route==="/inbox"&&<InboxScreen socket={realtime}/>}
        {route==="/notifications"&&<NotificationCenter socket={realtime}/>}
        {route==="/discover"&&<section className="discover-creator-feed"><div className="page-heading"><div><span className="eyebrow">FROM THE COMMUNITY</span><h2>Discover videos</h2><p>Watch videos published by creators on NERLOQ.</p></div></div><VideoFeed type="for_you" /></section>}
        {route==="/studio"&&<><div className="studio-grid"><section className="studio-upload"><div className="studio-card-top"><span className="eyebrow">PUBLISHING</span></div><h2>Bring your next idea<br/>into focus.</h2><p>Choose an original video, add its details and publish it to your community.</p><label className="upload-zone"><Upload size={21}/><strong>{file?file.name:"Choose a video"}</strong><span>{file?`${(file.size/1024/1024).toFixed(1)} MB · Ready to prepare`:"MP4, MOV or WebM · Up to 500 MB"}</span><input type="file" accept="video/mp4,video/quicktime,video/webm" onChange={e=>chooseVideo(e.target.files?.[0]??null)}/></label>{publishError&&<p className="form-error" role="alert">{publishError}</p>}{file&&<button className="primary-action" onClick={()=>navigate("/create",{state:{file}})}><Upload size={16}/> Continue to editor</button>}</section><section className="studio-side"><div className="studio-card-top"><span className="eyebrow">CREATOR TOOLS</span><Activity size={16}/></div><h3>Publish, learn, refine.</h3><p>Manage every video and review lifetime engagement below.</p><div className="studio-divider"/><Link to="/profile" className="studio-link">Manage your profile <span>↗</span></Link></section></div><StudioOverview/></>}
        {route==="/create"&&<form className="create-layout" onSubmit={publishVideo}><div className="create-intro"><span className="eyebrow">VIDEO WORKFLOW</span><h2>From first frame<br/>to <em>your people.</em></h2><p>Choose your video, write a caption and select its audience. Your video is uploaded to NERLOQ’s configured media storage.</p><div className="workflow-steps"><div className="workflow-step active"><b>01</b><span>Choose media</span></div><div className={`workflow-step ${file?"active":""}`}><b>02</b><span>Caption & prepare</span></div><div className={`workflow-step ${file&&durationMs>0?"active":""}`}><b>03</b><span>Audience & publish</span></div></div><p className="draft-note">{draftReady && (caption || privacy !== "public") ? "Draft details restore automatically on this device." : "Your caption and audience are saved locally while you work."}</p></div><div className="create-picker"><label className="upload-zone large"><Upload size={24}/><strong>{file?file.name:"Select a video from this device"}</strong><span>{file?`${(file.size/1024/1024).toFixed(1)} MB · ${durationMs?`${Math.round(durationMs/1000)} seconds`:"Reading video details…"}`:"MP4, MOV or WebM · Maximum 500 MB"}</span><input type="file" accept="video/mp4,video/quicktime,video/webm" onChange={e=>chooseVideo(e.target.files?.[0]??null)}/></label><label className="field create-caption"><span>Caption <small>{caption.length} / 2,200</small></span><span className="field-input field-textarea"><textarea value={caption} onChange={e=>setCaption(e.target.value)} maxLength={2200} rows={3} placeholder="Give your video a little context…"/></span></label><section className="cover-editor" aria-label="Video cover"><div><span className="eyebrow">COVER IMAGE</span><p>Choose the frame people see before they play your video.</p></div><div className="cover-preview">{coverPreview?<img src={coverPreview} alt="Video cover preview"/>:<div className="cover-placeholder"><ImagePlus size={22}/><span>{coverBusy?"Preparing a cover…":"No cover image"}</span></div>}{coverBusy&&<span className="cover-busy"><LoaderCircle size={15}/> Processing locally</span>}</div>{file&&durationMs>0&&<label className="cover-frame-control"><span>Video frame <small>{coverTime.toFixed(1)}s</small></span><input type="range" min="0" max={Math.max(0.2,durationMs/1000)} step="0.1" value={Math.min(coverTime,Math.max(0.2,durationMs/1000))} onChange={event=>{setCoverSource(null);setCoverTime(Number(event.target.value));}} aria-label="Select video cover frame"/></label>}<label className="quiet-action cover-select"><ImagePlus size={15}/> Choose image<input type="file" accept="image/jpeg,image/png,image/webp" onChange={event=>{const selected=event.target.files?.[0];if(!selected)return;const generation=++coverGeneration.current;setCoverBusy(true);setCoverError("");void normalizeCoverImage(selected).then(image=>{if(generation===coverGeneration.current){setCover(image);setCoverSource("custom");}}).catch(cause=>{if(generation===coverGeneration.current)setCoverError(cause instanceof Error?cause.message:"Cover image could not be processed.");}).finally(()=>{if(generation===coverGeneration.current)setCoverBusy(false);});event.currentTarget.value="";}}/></label>{coverError&&<p className="cover-error" role="status">{coverError} You can still publish without a cover.</p>}</section><label className="field create-privacy"><span>Who can view this video</span><span className="field-input"><select value={privacy} onChange={e=>setPrivacy(e.target.value as typeof privacy)}><option value="public">Everyone · Public</option><option value="followers">Followers</option><option value="private">Only me · Private</option></select></span></label><label className="create-toggle"><input type="checkbox" checked={commentsAllowed} onChange={e=>setCommentsAllowed(e.target.checked)}/><span>Allow comments</span></label>{publishError&&<p className="form-error" role="alert">{publishError}</p>}{publishSuccess&&<p className="saved-message" role="status">{publishSuccess}</p>}<div className="create-actions"><button className="quiet-action" type="button" onClick={()=>{try{window.localStorage.removeItem(draftKey);}catch{/* Ignore unavailable storage. */}setCaption("");setPrivacy("public");setCommentsAllowed(true);setPublishError("");}}>Clear draft</button><button className="submit-button publish-button" type="submit" disabled={!file||durationMs<1||publishing||coverBusy||Boolean(publishSuccess)}>{publishing?"Uploading and publishing…":publishSuccess?"Published":"Publish video"}<Upload size={17}/></button>{publishing&&<div className="upload-status" role="status"><span>Transferring video <strong>{uploadProgress}%</strong></span><progress value={uploadProgress} max="100"/></div>}</div><div className="create-capabilities"><span><Shield size={15}/> Visibility enforced by the API</span><span>By publishing, you confirm you have the rights to this video.</span></div></div></form>}
        {route==="/settings"&&<SettingsPanel/>}
      </div>
      <footer className="platform-footer"><span>CREATE. CONNECT. DISCOVER.</span><span>NERLOQ · {new Date().getFullYear()}</span></footer>
    </main>
    <nav className="mobile-tabs" aria-label="Mobile navigation"><Link to="/home" className={route==="/home"?"active":""} aria-current={route==="/home"?"page":undefined}><Home size={19}/><span>For you</span></Link><Link to="/discover" className={route==="/discover"?"active":""} aria-current={route==="/discover"?"page":undefined}><Compass size={19}/><span>Discover</span></Link><Link to="/create" className={route==="/create"?"active":""} aria-current={route==="/create"?"page":undefined}><Plus size={20}/><span>Create</span></Link><Link to="/inbox" className={route==="/inbox"?"active":""} aria-current={route==="/inbox"?"page":undefined}><Inbox size={19}/><span>Inbox</span>{unreadCount>0&&<i className="mobile-nav-dot" aria-label={`${unreadCount} unread notifications`}/>}</Link><Link to="/profile" className={route==="/profile"?"active":""} aria-current={route==="/profile"?"page":undefined}><UserRound size={19}/><span>Profile</span></Link></nav>
  </div>;
}
