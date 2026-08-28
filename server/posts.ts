import { Router, Response } from "express";
import crypto from "crypto";
import { dbGet, dbAll, dbRun, PostRow, PostCommentRow, UserRow } from "./db";
import { AuthedRequest, requireAuth } from "./auth";
import { asyncHandler } from "./asyncHandler";

export const postsRouter = Router();
postsRouter.use(requireAuth);

const REACTION_TYPES = ["like", "celebrate", "insightful", "kudos"] as const;
type ReactionType = (typeof REACTION_TYPES)[number];

const STRUCTURED_CONFERENCE_POST_TYPES = new Set([
  "achievement",
  "cfp",
  "speaker",
  "sponsorship",
  "review",
  "celebration",
]);

const DIRECT_CONFERENCE_TERMS =
  /\b(conferences?|congress(?:es)?|symposi(?:um|a)|summits?|conventions?|scientific meetings?|academic events?|call[ -]?for[ -]?papers?|cfp|abstracts?|manuscripts?|paper submissions?|submission deadlines?|camera[ -]?ready|proceedings)\b/i;
const CONFERENCE_ACTIVITY_TERMS =
  /\b(keynotes?|plenary|invited speakers?|speakers?|sessions?|workshops?|tutorials?|panels?|program(?:me)?|agenda|committees?|chairs?|reviewers?|peer review|venues?|registrations?|sponsors?|exhibitors?|posters?|presentations?|tracks?|acceptance|accepted|deadlines?)\b/i;

function meaningfulWordCount(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((token) => token.replace(/[^\p{L}\p{N}]/gu, "").length >= 2).length;
}

function isConferencePostContent(
  content: string,
  postType?: string | null,
  conferenceTitle?: string | null,
  conferenceId?: string | null
): boolean {
  if (meaningfulWordCount(content) < 2) return false;
  if (DIRECT_CONFERENCE_TERMS.test(content) || CONFERENCE_ACTIVITY_TERMS.test(content)) return true;
  return Boolean(
    STRUCTURED_CONFERENCE_POST_TYPES.has(postType || "") &&
      (conferenceTitle?.trim() || conferenceId?.trim())
  );
}

function isConferenceComment(text: string): boolean {
  return (
    meaningfulWordCount(text) >= 2 &&
    (DIRECT_CONFERENCE_TERMS.test(text) || CONFERENCE_ACTIVITY_TERMS.test(text))
  );
}

function reactionCountKey(reaction: ReactionType): "likes" | "celebrates" | "insightful" | "kudos" {
  return reaction === "like" ? "likes" : reaction === "celebrate" ? "celebrates" : reaction;
}

async function toPostDTO(row: PostRow, viewerId: string) {
  const reactionRows = await dbAll<{ reaction: ReactionType; count: number }>(
    "SELECT reaction, COUNT(*) as count FROM post_reactions WHERE post_id = ? GROUP BY reaction",
    [row.id]
  );
  const reactions = { likes: 0, celebrates: 0, insightful: 0, kudos: 0 };
  reactionRows.forEach((r) => {
    reactions[reactionCountKey(r.reaction)] = r.count;
  });

  const myReactionRow = await dbGet<{ reaction: ReactionType }>(
    "SELECT reaction FROM post_reactions WHERE post_id = ? AND user_id = ?",
    [row.id, viewerId]
  );

  const commentRows = await dbAll<{ text: string }>(
    "SELECT text FROM post_comments WHERE post_id = ?",
    [row.id]
  );
  const commentsCount = commentRows.filter((comment) => isConferenceComment(comment.text)).length;

  const repostsCountRow = (await dbGet<{ count: number }>(
    "SELECT COUNT(*) as count FROM post_reposts WHERE post_id = ?",
    [row.id]
  ))!;

  const myRepost = await dbGet<{ id: string }>(
    "SELECT id FROM post_reposts WHERE post_id = ? AND user_id = ?",
    [row.id, viewerId]
  );
  const mySave = await dbGet<{ id: string }>(
    "SELECT id FROM post_saves WHERE post_id = ? AND user_id = ?",
    [row.id, viewerId]
  );

  return {
    id: row.id,
    authorName: row.author_name,
    authorTitle: row.author_title || "",
    authorOrg: row.author_org || "",
    authorAvatar: row.author_avatar || "",
    authorUserId: row.author_user_id || undefined,
    content: row.content,
    timestamp: row.created_at,
    postType: row.post_type,
    conferenceId: row.conference_id || undefined,
    conferenceBadge: row.conference_title || undefined,
    celebrationKind: row.celebration_kind || undefined,
    celebrationHeadline: row.celebration_headline || undefined,
    reactions,
    userReaction: myReactionRow?.reaction,
    commentsCount,
    repostsCount: repostsCountRow.count,
    isReposted: !!myRepost,
    isSaved: !!mySave,
  };
}

// The real community feed — every post, reaction, comment, repost, and save is backed by an
// actual account and persisted, never client-only state.
postsRouter.get(
  "/",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const rows = await dbAll<PostRow>("SELECT * FROM posts ORDER BY created_at DESC LIMIT 300");
    const relevantRows = rows
      .filter((row) =>
        isConferencePostContent(row.content, row.post_type, row.conference_title, row.conference_id)
      )
      .slice(0, 100);
    const posts = await Promise.all(relevantRows.map((row) => toPostDTO(row, req.userId!)));
    res.json({ posts });
  })
);

postsRouter.post(
  "/",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const body = req.body || {};
    if (typeof body.content !== "string" || !body.content.trim()) {
      return res.status(400).json({ error: "content is required" });
    }

    const me = (await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [req.userId!]))!;
    const postType = typeof body.postType === "string" ? body.postType : "announcement";
    const conferenceTitle = typeof body.conferenceTitle === "string" ? body.conferenceTitle : null;
    const conferenceId = typeof body.conferenceId === "string" ? body.conferenceId : null;

    if (!isConferencePostContent(body.content, postType, conferenceTitle, conferenceId)) {
      return res.status(422).json({
        error:
          "Only conference-related posts are allowed. Mention a conference, call for papers, abstract, submission, program, speaker, committee, venue, or related conference activity.",
      });
    }

    const id = `post_${crypto.randomUUID()}`;
    await dbRun(
      `INSERT INTO posts (
        id, author_id, author_name, author_title, author_org, author_avatar, author_user_id,
        content, post_type, conference_id, conference_title, celebration_kind, celebration_headline
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        req.userId!,
        typeof body.authorName === "string" && body.authorName.trim() ? body.authorName.trim() : me.name,
        typeof body.authorTitle === "string" ? body.authorTitle : me.title,
        typeof body.authorOrg === "string" ? body.authorOrg : me.organization,
        typeof body.authorAvatar === "string" ? body.authorAvatar : me.avatar,
        typeof body.authorUserId === "string" ? body.authorUserId : body.authorName ? null : req.userId!,
        body.content.trim(),
        postType,
        conferenceId,
        conferenceTitle,
        typeof body.celebrationKind === "string" ? body.celebrationKind : null,
        typeof body.celebrationHeadline === "string" ? body.celebrationHeadline : null,
      ]
    );

    const row = (await dbGet<PostRow>("SELECT * FROM posts WHERE id = ?", [id]))!;
    res.status(201).json({ post: await toPostDTO(row, req.userId!) });
  })
);

// Toggle a reaction: same reaction again removes it, a different reaction switches it.
postsRouter.post(
  "/:id/react",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const reaction = req.body?.reaction;
    if (!REACTION_TYPES.includes(reaction)) {
      return res.status(400).json({ error: "reaction must be one of like, celebrate, insightful, kudos" });
    }
    const post = await dbGet<PostRow>("SELECT id FROM posts WHERE id = ?", [req.params.id]);
    if (!post) {
      return res.status(404).json({ error: "Post not found" });
    }

    const existing = await dbGet<{ id: string; reaction: ReactionType }>(
      "SELECT id, reaction FROM post_reactions WHERE post_id = ? AND user_id = ?",
      [req.params.id, req.userId!]
    );
    if (existing?.reaction === reaction) {
      await dbRun("DELETE FROM post_reactions WHERE id = ?", [existing.id]);
    } else if (existing) {
      await dbRun("UPDATE post_reactions SET reaction = ? WHERE id = ?", [reaction, existing.id]);
    } else {
      await dbRun("INSERT INTO post_reactions (id, post_id, user_id, reaction) VALUES (?, ?, ?, ?)", [
        `preact_${crypto.randomUUID()}`,
        req.params.id,
        req.userId!,
        reaction,
      ]);
    }

    const row = (await dbGet<PostRow>("SELECT * FROM posts WHERE id = ?", [req.params.id]))!;
    res.json({ post: await toPostDTO(row, req.userId!) });
  })
);

postsRouter.get(
  "/:id/comments",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const rows = await dbAll<PostCommentRow & { name: string; avatar: string | null }>(
      `SELECT pc.*, u.name as name, u.avatar as avatar
       FROM post_comments pc
       JOIN users u ON u.id = pc.author_id
       WHERE pc.post_id = ?
       ORDER BY pc.created_at ASC`,
      [req.params.id]
    );
    res.json({
      comments: rows
        .filter((r) => isConferenceComment(r.text))
        .map((r) => ({
          id: r.id,
          authorId: r.author_id,
          authorName: r.name,
          authorAvatar: r.avatar || "",
          text: r.text,
          timestamp: r.created_at,
        })),
    });
  })
);

postsRouter.post(
  "/:id/comments",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const text = req.body?.text;
    if (typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ error: "text is required" });
    }
    if (!isConferenceComment(text)) {
      return res.status(422).json({
        error:
          "Comments must be about conferences, calls for papers, abstracts, submissions, programs, speakers, committees, venues, or related conference activity.",
      });
    }
    const post = await dbGet<PostRow>("SELECT id FROM posts WHERE id = ?", [req.params.id]);
    if (!post) {
      return res.status(404).json({ error: "Post not found" });
    }
    const id = `pcom_${crypto.randomUUID()}`;
    await dbRun("INSERT INTO post_comments (id, post_id, author_id, text) VALUES (?, ?, ?, ?)", [
      id,
      req.params.id,
      req.userId!,
      text.trim(),
    ]);
    const me = (await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [req.userId!]))!;
    res.status(201).json({
      comment: {
        id,
        authorId: req.userId!,
        authorName: me.name,
        authorAvatar: me.avatar || "",
        text: text.trim(),
        timestamp: new Date().toISOString(),
      },
    });
  })
);

postsRouter.post(
  "/:id/repost",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const existing = await dbGet<{ id: string }>(
      "SELECT id FROM post_reposts WHERE post_id = ? AND user_id = ?",
      [req.params.id, req.userId!]
    );
    if (existing) {
      await dbRun("DELETE FROM post_reposts WHERE id = ?", [existing.id]);
    } else {
      const post = await dbGet<PostRow>("SELECT id FROM posts WHERE id = ?", [req.params.id]);
      if (!post) {
        return res.status(404).json({ error: "Post not found" });
      }
      await dbRun("INSERT INTO post_reposts (id, post_id, user_id) VALUES (?, ?, ?)", [
        `prep_${crypto.randomUUID()}`,
        req.params.id,
        req.userId!,
      ]);
    }
    const row = (await dbGet<PostRow>("SELECT * FROM posts WHERE id = ?", [req.params.id]))!;
    res.json({ post: await toPostDTO(row, req.userId!) });
  })
);

postsRouter.post(
  "/:id/save",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const existing = await dbGet<{ id: string }>(
      "SELECT id FROM post_saves WHERE post_id = ? AND user_id = ?",
      [req.params.id, req.userId!]
    );
    if (existing) {
      await dbRun("DELETE FROM post_saves WHERE id = ?", [existing.id]);
    } else {
      const post = await dbGet<PostRow>("SELECT id FROM posts WHERE id = ?", [req.params.id]);
      if (!post) {
        return res.status(404).json({ error: "Post not found" });
      }
      await dbRun("INSERT INTO post_saves (id, post_id, user_id) VALUES (?, ?, ?)", [
        `psave_${crypto.randomUUID()}`,
        req.params.id,
        req.userId!,
      ]);
    }
    const row = (await dbGet<PostRow>("SELECT * FROM posts WHERE id = ?", [req.params.id]))!;
    res.json({ post: await toPostDTO(row, req.userId!) });
  })
);
