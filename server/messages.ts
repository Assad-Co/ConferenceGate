import { Router, Response } from "express";
import crypto from "crypto";
import type { WebSocket } from "ws";
import { dbGet, dbAll, dbRun, UserRow, ConversationRow, MessageRow } from "./db";
import { AuthedRequest, requireAuth, publicUserSummary } from "./auth";
import { asyncHandler } from "./asyncHandler";

export const messagesRouter = Router();
messagesRouter.use(requireAuth);

function conversationKey(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

async function findConversation(userA: string, userB: string): Promise<ConversationRow | undefined> {
  const [a, b] = conversationKey(userA, userB);
  return dbGet<ConversationRow>("SELECT * FROM conversations WHERE user_a = ? AND user_b = ?", [a, b]);
}

async function getOrCreateConversation(userA: string, userB: string): Promise<ConversationRow> {
  const existing = await findConversation(userA, userB);
  if (existing) return existing;
  const [a, b] = conversationKey(userA, userB);
  const id = `conv_${crypto.randomUUID()}`;
  await dbRun("INSERT INTO conversations (id, user_a, user_b) VALUES (?, ?, ?)", [id, a, b]);
  return (await dbGet<ConversationRow>("SELECT * FROM conversations WHERE id = ?", [id]))!;
}

function toMessageDTO(row: MessageRow) {
  return {
    id: row.id,
    senderId: row.sender_id,
    text: row.text,
    createdAt: row.created_at,
  };
}

messagesRouter.get("/conversations", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const me = req.userId!;
  const convs = await dbAll<ConversationRow>("SELECT * FROM conversations WHERE user_a = ? OR user_b = ?", [
    me,
    me,
  ]);

  const result = (
    await Promise.all(
      convs.map(async (c) => {
        const partnerId = c.user_a === me ? c.user_b : c.user_a;
        const partner = await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [partnerId]);
        if (!partner) return null;
        const lastMsg = await dbGet<MessageRow>(
          "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1",
          [c.id]
        );
        const unread = (await dbGet<{ n: number }>(
          "SELECT COUNT(*) as n FROM messages WHERE conversation_id = ? AND sender_id != ? AND read_at IS NULL",
          [c.id, me]
        ))!;
        return {
          partnerId,
          partner: publicUserSummary(partner),
          lastMessage: lastMsg?.text || null,
          lastMessageAt: lastMsg?.created_at || c.created_at,
          unreadCount: unread.n,
        };
      })
    )
  )
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1));

  res.json({ conversations: result });
}));

messagesRouter.get("/unread-count", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const me = req.userId!;
  const row = (await dbGet<{ n: number }>(
    `SELECT COUNT(*) as n FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     WHERE (c.user_a = ? OR c.user_b = ?) AND m.sender_id != ? AND m.read_at IS NULL`,
    [me, me, me]
  ))!;
  res.json({ unreadCount: row.n });
}));

messagesRouter.get("/conversations/:partnerId/messages", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const me = req.userId!;
  const partnerId = req.params.partnerId;
  const partner = await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [partnerId]);
  if (!partner) {
    return res.status(404).json({ error: "That person could not be found." });
  }

  const conv = await findConversation(me, partnerId);
  if (!conv) {
    return res.json({ partner: publicUserSummary(partner), messages: [] });
  }

  const rows = await dbAll<MessageRow>("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC", [
    conv.id,
  ]);
  res.json({ partner: publicUserSummary(partner), messages: rows.map(toMessageDTO) });
}));

messagesRouter.post("/conversations/:partnerId/read", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const me = req.userId!;
  const partnerId = req.params.partnerId;
  const conv = await findConversation(me, partnerId);
  if (conv) {
    await dbRun(
      "UPDATE messages SET read_at = datetime('now') WHERE conversation_id = ? AND sender_id != ? AND read_at IS NULL",
      [conv.id, me]
    );
  }
  res.json({ ok: true });
}));

// --- Real-time delivery -----------------------------------------------------

const socketsByUser = new Map<string, Set<WebSocket>>();

export function registerSocket(userId: string, socket: WebSocket) {
  if (!socketsByUser.has(userId)) socketsByUser.set(userId, new Set());
  socketsByUser.get(userId)!.add(socket);
  socket.on("close", () => {
    const set = socketsByUser.get(userId);
    set?.delete(socket);
    if (set && set.size === 0) socketsByUser.delete(userId);
  });
}

function broadcastToUser(userId: string, payload: unknown) {
  const sockets = socketsByUser.get(userId);
  if (!sockets || sockets.size === 0) return;
  const data = JSON.stringify(payload);
  for (const socket of sockets) {
    if (socket.readyState === socket.OPEN) {
      try {
        socket.send(data);
      } catch {
        // A stale socket (e.g. left over from an abrupt disconnect) shouldn't
        // block delivery to this user's other, live connections.
      }
    }
  }
}

const MAX_MESSAGE_LENGTH = 4000;

messagesRouter.post("/conversations/:partnerId/messages", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const me = req.userId!;
  const partnerId = req.params.partnerId;
  if (partnerId === me) {
    return res.status(400).json({ error: "You can't message yourself." });
  }

  const partner = await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [partnerId]);
  if (!partner) {
    return res.status(404).json({ error: "That person could not be found." });
  }

  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text) {
    return res.status(400).json({ error: "Message text is required" });
  }
  if (text.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: `Messages must be ${MAX_MESSAGE_LENGTH} characters or fewer` });
  }

  const conv = await getOrCreateConversation(me, partnerId);
  const id = `msg_${crypto.randomUUID()}`;
  await dbRun("INSERT INTO messages (id, conversation_id, sender_id, text) VALUES (?, ?, ?, ?)", [
    id,
    conv.id,
    me,
    text,
  ]);
  const row = (await dbGet<MessageRow>("SELECT * FROM messages WHERE id = ?", [id]))!;
  const dto = toMessageDTO(row);

  const meRow = (await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [me]))!;
  broadcastToUser(partnerId, {
    type: "message",
    partnerId: me,
    partner: publicUserSummary(meRow),
    message: dto,
  });

  res.status(201).json({ message: dto });
}));

messagesRouter.get("/users/search", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!q) {
    return res.json({ users: [] });
  }
  const rows = await dbAll<UserRow>("SELECT * FROM users WHERE id != ? AND name LIKE ? ORDER BY name ASC LIMIT 10", [
    req.userId!,
    `%${q}%`,
  ]);
  res.json({ users: rows.map(publicUserSummary) });
}));
