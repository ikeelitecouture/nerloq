import React from "react";
import type { Socket } from "socket.io-client";
import { useSearchParams } from "react-router-dom";
import { Check, CheckCheck, FileText, LoaderCircle, MessageCircle, Send, Trash2, UserRound, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { Message } from "@nerloq/shared";
import { api, resolveMediaUrl, type ConversationSummary, type MessagePage } from "../../lib/api";
import { FollowRequests } from "./FollowRequests";

export function InboxScreen({ socket }: { socket: Socket | null }): React.JSX.Element {
  const [params, setParams] = useSearchParams();
  const targetId = params.get("to") ?? "";
  const targetName = params.get("username") ?? "creator";
  const [conversations, setConversations] = React.useState<readonly ConversationSummary[]>([]);
  const [hasMoreConversations, setHasMoreConversations] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState("");
  const [thread, setThread] = React.useState<MessagePage | null>(null);
  const [hasMoreMessages, setHasMoreMessages] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [loadingMessages, setLoadingMessages] = React.useState(false);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState("");
  const [typingPeer, setTypingPeer] = React.useState(false);
  const [peerOnline, setPeerOnline] = React.useState(false);
  const typingTimer = React.useRef<number | null>(null);
  const conversationCursorRef = React.useRef<string | null>(null);
  const messageCursorRef = React.useRef<string | null>(null);

  const loadConversations = React.useCallback(async (next = false) => {
    if (next) setLoadingMore(true); else setLoading(true);
    setError("");
    try {
      const result = await api.conversations(next ? conversationCursorRef.current ?? undefined : undefined);
      setConversations(current => next ? [...current, ...result.items.filter(item => !current.some(existing => existing.id === item.id))] : result.items);
      conversationCursorRef.current = result.pagination.cursor;
      setHasMoreConversations(result.pagination.hasMore);
      if (!next) setSelectedId(current => current || (targetId ? result.items.find(item => item.peer.id === targetId)?.id ?? "" : result.items.find(item => item.requestStatus === "accepted")?.id || result.items[0]?.id || ""));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Inbox could not be loaded."); }
    finally { setLoading(false); setLoadingMore(false); }
  }, [targetId]);

  const loadThread = React.useCallback(async (id: string, next = false) => {
    if (!id) { setThread(null); return; }
    if (next) setLoadingMessages(true); else setError("");
    try {
      const result = await api.messages(id, next ? messageCursorRef.current ?? undefined : undefined);
       setThread(current => next && current ? { ...result, items: [...result.items.filter(item => !current.items.some(existing => existing.id === item.id)), ...current.items] } : result);
      messageCursorRef.current = result.pagination.cursor;
      setHasMoreMessages(result.pagination.hasMore);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Conversation could not be loaded."); }
    finally { setLoadingMessages(false); }
  }, []);

  React.useEffect(() => { let active = true; queueMicrotask(() => { if (active) void loadConversations(false); }); return () => { active = false; }; }, [loadConversations]);
  React.useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      messageCursorRef.current = null;
      setHasMoreMessages(false);
      if (!selectedId) { setThread(null); return; }
      void loadThread(selectedId, false);
    });
    const timer = window.setInterval(() => { if (!socket?.connected) void loadThread(selectedId, false); }, 6000);
    return () => { active = false; window.clearInterval(timer); };
  }, [loadThread, selectedId, socket]);

  React.useEffect(() => {
    if (!socket) return;
    const refreshInbox = () => { void loadConversations(false); };
    socket.on("inbox:updated", refreshInbox); socket.on("message:request", refreshInbox);
    return () => { socket.off("inbox:updated", refreshInbox); socket.off("message:request", refreshInbox); };
  }, [loadConversations, socket]);

  React.useEffect(() => {
    if (!socket || !selectedId) return;
    const onMessage = (event: { conversationId?: string }) => { if (event.conversationId === selectedId) { void loadThread(selectedId, false); void loadConversations(false); } };
    const onAccepted = (event: { conversationId?: string }) => { if (event.conversationId === selectedId) { socket.emit("conversation:join", { conversationId: selectedId }); void loadThread(selectedId, false); void loadConversations(false); } };
    const onDeclined = (event: { conversationId?: string }) => { if (event.conversationId === selectedId) { setThread(null); setSelectedId(""); void loadConversations(false); } };
    const onTyping = (event: { conversationId?: string; userId?: string; typing?: boolean }) => { if (event.conversationId === selectedId && event.userId === thread?.conversation.peer?.id) setTypingPeer(Boolean(event.typing)); };
    const onPresence = (event: { userId?: string; online?: boolean }) => { if (event.userId === thread?.conversation.peer?.id) setPeerOnline(Boolean(event.online)); };
    socket.on("message:new", onMessage); socket.on("message:updated", onMessage); socket.on("conversation:accepted", onAccepted); socket.on("conversation:declined", onDeclined); socket.on("typing:update", onTyping); socket.on("presence:update", onPresence);
    socket.emit("conversation:join", { conversationId: selectedId });
    return () => { socket.emit("conversation:leave", { conversationId: selectedId }); socket.emit("typing:update", { conversationId: selectedId, typing: false }); socket.off("message:new", onMessage); socket.off("message:updated", onMessage); socket.off("conversation:accepted", onAccepted); socket.off("conversation:declined", onDeclined); socket.off("typing:update", onTyping); socket.off("presence:update", onPresence); };
  }, [loadConversations, loadThread, selectedId, socket, thread?.conversation.peer?.id]);

  function changeDraft(value: string) {
    setDraft(value);
    if (socket?.connected && selectedId && thread?.conversation.requestStatus === "accepted") {
      socket.emit("typing:update", { conversationId: selectedId, typing: true });
      if (typingTimer.current !== null) window.clearTimeout(typingTimer.current);
      typingTimer.current = window.setTimeout(() => socket.emit("typing:update", { conversationId: selectedId, typing: false }), 1200);
    }
  }

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    if (typingTimer.current !== null) window.clearTimeout(typingTimer.current);
    if (socket?.connected && selectedId) socket.emit("typing:update", { conversationId: selectedId, typing: false });
    setBusy(true); setError(""); setNotice("");
    try {
      if (!selectedId && targetId) {
        const result = await api.startConversation(targetId, text);
        setSelectedId(result.conversationId); setParams({}, { replace: true }); setNotice(result.requestStatus === "pending" ? "Message request sent." : "Message sent.");
        await loadConversations(false); await loadThread(result.conversationId, false);
      } else if (selectedId && thread?.conversation.requestStatus === "accepted") {
        await api.sendMessage(selectedId, text); setNotice("Message sent."); await loadThread(selectedId, false); await loadConversations(false);
      } else if (!selectedId) {
        setError("Choose a conversation or open a creator profile to start a message."); return;
      } else {
        setError("Accept the message request before replying."); return;
      }
      setDraft("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Message could not be sent."); }
    finally { setBusy(false); }
  }

  async function removeMessage(messageId: string) {
    setBusy(true); setError("");
    try { await api.deleteMessage(messageId); if (selectedId) await loadThread(selectedId, false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Message could not be removed."); }
    finally { setBusy(false); }
  }

  async function resolveRequest(accept: boolean) {
    if (!selectedId) return;
    setBusy(true); setError("");
    try { if (accept) { await api.acceptMessageRequest(selectedId); setNotice("Message request accepted."); } else { await api.declineMessageRequest(selectedId); setNotice("Message request declined."); setSelectedId(""); setThread(null); } await loadConversations(false); if (accept) await loadThread(selectedId, false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Request could not be updated."); }
    finally { setBusy(false); }
  }

  const selected = conversations.find(item => item.id === selectedId);
  const messages = [...(thread?.items ?? [])];
  return <div className="inbox-workspace">
    <FollowRequests/>
    <section className="messaging-shell" aria-label="Direct messages">
      <aside className="conversation-list"><div className="conversation-list-heading"><span className="eyebrow">MESSAGES</span><button className="quiet-action" onClick={() => void loadConversations(false)} disabled={loading}><LoaderCircle size={14}/> Refresh</button></div>{loading ? <div className="comments-state">Loading conversations…</div> : conversations.length === 0 ? <div className="conversation-list-empty"><MessageCircle size={20}/><p>Your conversations will appear here.</p><small>Visit a creator profile to start a message.</small></div> : conversations.map(item => <button key={item.id} type="button" className={`conversation-entry ${selectedId === item.id ? "selected" : ""}`} onClick={() => { setSelectedId(item.id); setThread(null); setError(""); }}><span className="conversation-avatar">{item.peer.avatarUrl ? <img src={resolveMediaUrl(item.peer.avatarUrl)} alt=""/> : item.peer.displayName.slice(0, 1).toUpperCase()}</span><span className="conversation-entry-copy"><strong>{item.peer.displayName}</strong><small>{item.requestStatus === "pending" ? item.incomingRequest ? "Message request" : "Request sent" : item.lastMessage?.text ?? "Start a conversation"}</small></span>{item.unreadCount > 0 && <span className="conversation-unread">{item.unreadCount}</span>}</button>)}{hasMoreConversations && <button className="quiet-action list-more" disabled={loadingMore} onClick={() => void loadConversations(true)}>{loadingMore ? "Loading…" : "Load more"}</button>}</aside>
      <section className="message-pane">
        {selectedId && thread ? <><header className="message-header"><span className="conversation-avatar">{thread.conversation.peer?.avatarUrl ? <img src={resolveMediaUrl(thread.conversation.peer.avatarUrl)} alt=""/> : thread.conversation.peer?.displayName.slice(0, 1).toUpperCase() ?? <UserRound size={17}/>}</span><div><strong>{thread.conversation.peer?.displayName ?? selected?.peer.displayName ?? "Conversation"}</strong><small>{typingPeer ? "Typing…" : peerOnline ? "Active on NERLOQ" : thread.conversation.requestStatus === "pending" ? thread.conversation.incomingRequest ? "Message request" : "Awaiting response" : "NERLOQ messages"}</small></div>{thread.conversation.incomingRequest && <div className="message-request-actions"><button className="primary-action" disabled={busy} onClick={() => void resolveRequest(true)}><Check size={14}/> Accept</button><button className="quiet-action" disabled={busy} onClick={() => void resolveRequest(false)}><X size={14}/> Decline</button></div>}</header><div className="message-thread" aria-live="polite">{hasMoreMessages && <button className="quiet-action messages-more" disabled={loadingMessages} onClick={() => void loadThread(selectedId, true)}>{loadingMessages ? "Loading earlier messages…" : "Load earlier messages"}</button>}{messages.length === 0 ? <div className="conversation-list-empty"><MessageCircle size={22}/><p>No messages yet.</p></div> : messages.map(message => <MessageBubble key={message.id} message={message} peerId={thread.conversation.peer?.id ?? ""} busy={busy} onRemove={removeMessage}/>)}</div>{thread.conversation.requestStatus === "accepted" && <form className="message-composer" onSubmit={event => { event.preventDefault(); void send(); }}><textarea value={draft} onChange={event => changeDraft(event.target.value)} maxLength={4000} rows={2} aria-label="Write a message" placeholder="Write a thoughtful message…"/><button className="primary-action" type="submit" disabled={busy || !draft.trim()} aria-label="Send message">{busy ? <LoaderCircle size={17}/> : <Send size={17}/>}</button></form>}{thread.conversation.requestStatus === "pending" && <div className="message-request-banner">{thread.conversation.incomingRequest ? "Accept this request to reply. The sender cannot message you again unless you accept." : "Your message request is waiting for a response."}</div>}</> : targetId ? <div className="message-start"><span className="conversation-avatar"><UserRound size={18}/></span><h3>Message {targetName}</h3><p>Your first message will arrive as a request if this creator does not already follow you.</p><form className="message-composer start-composer" onSubmit={event => { event.preventDefault(); void send(); }}><textarea value={draft} onChange={event => changeDraft(event.target.value)} maxLength={4000} rows={3} aria-label="Write a message" placeholder="Write a thoughtful message…"/><button className="primary-action" type="submit" disabled={busy || !draft.trim()}>{busy ? <LoaderCircle size={17}/> : <><Send size={15}/> Send</>}</button></form></div> : <div className="message-start"><div className="message-start-mark"><MessageCircle size={25}/></div><h3>Your conversations, with room to breathe.</h3><p>Choose a conversation to continue. Message requests stay in your control.</p></div>}
      </section>
    </section>
    {error && <div className="explore-error" role="alert"><span>{error}</span><button className="quiet-action" onClick={() => { setError(""); void loadConversations(false); }}>Try again</button></div>}{notice && <p className="inline-note" role="status">{notice}</p>}
  </div>;
}

function MessageBubble({ message, peerId, busy, onRemove }: { message: Message; peerId: string; busy: boolean; onRemove: (messageId: string) => void }): React.JSX.Element {
  const own = message.sender.id !== peerId;
  return <article className={`message-bubble ${own ? "sent" : "received"}`}><p>{message.deletedAt ? "Message removed" : message.text ?? (message.attachments.length ? "Attachment" : "")}</p>{message.attachments.map(attachment => <a className="message-attachment" key={attachment.id} href={resolveMediaUrl(attachment.url)} target="_blank" rel="noreferrer">{attachment.type === "image" ? <img src={resolveMediaUrl(attachment.url)} alt={attachment.name ?? "Message attachment"}/> : <><FileText size={15}/>{attachment.name ?? `${attachment.type} attachment`}</>}</a>)}<time dateTime={message.createdAt}>{formatDistanceToNow(new Date(message.createdAt), { addSuffix: true })}</time>{own && <div className="message-meta">{message.readAt && <CheckCheck size={13} aria-label="Read"/>}{!message.deletedAt && <button type="button" className="message-remove" aria-label="Remove message" disabled={busy} onClick={() => onRemove(message.id)}><Trash2 size={13}/></button>}</div>}</article>;
}
