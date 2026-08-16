export interface PublicUser {
  id: string;
  name: string;
  avatar: string | null;
  title: string | null;
  organization: string | null;
}

export interface ConversationSummary {
  partnerId: string;
  partner: PublicUser;
  lastMessage: string | null;
  lastMessageAt: string;
  unreadCount: number;
}

export interface MessageItem {
  id: string;
  senderId: string;
  text: string;
  createdAt: string;
}

async function parseResponse(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Something went wrong. Please try again.');
  }
  return data;
}

export async function fetchConversations(): Promise<ConversationSummary[]> {
  const res = await fetch('/api/messages/conversations', { credentials: 'include' });
  const data = await parseResponse(res);
  return data.conversations;
}

export async function fetchUnreadCount(): Promise<number> {
  const res = await fetch('/api/messages/unread-count', { credentials: 'include' });
  const data = await parseResponse(res);
  return data.unreadCount;
}

export async function fetchConversation(partnerId: string): Promise<{ partner: PublicUser; messages: MessageItem[] }> {
  const res = await fetch(`/api/messages/conversations/${partnerId}/messages`, { credentials: 'include' });
  return parseResponse(res);
}

export async function sendMessage(partnerId: string, text: string): Promise<MessageItem> {
  const res = await fetch(`/api/messages/conversations/${partnerId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ text }),
  });
  const data = await parseResponse(res);
  return data.message;
}

export async function markConversationRead(partnerId: string): Promise<void> {
  await fetch(`/api/messages/conversations/${partnerId}/read`, { method: 'POST', credentials: 'include' });
}

export async function searchUsers(query: string): Promise<PublicUser[]> {
  if (!query.trim()) return [];
  const res = await fetch(`/api/messages/users/search?q=${encodeURIComponent(query.trim())}`, {
    credentials: 'include',
  });
  const data = await parseResponse(res);
  return data.users;
}

export type MessageSocketEvent = {
  type: 'message';
  partnerId: string;
  partner: PublicUser;
  message: MessageItem;
};

/** Opens a real-time socket for incoming message pushes. Auth is via the existing session cookie. */
export function connectMessageSocket(onEvent: (evt: MessageSocketEvent) => void): WebSocket {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${window.location.host}/ws/messages`);
  socket.onmessage = (event) => {
    try {
      const parsed = JSON.parse(event.data);
      if (parsed?.type === 'message') onEvent(parsed as MessageSocketEvent);
    } catch {
      // ignore malformed frames
    }
  };
  return socket;
}
