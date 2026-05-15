import { generateEmbedding } from "../../utils/generateEmbedding.js";
import Conversation from "../../models/conversation.model.js";
import Message from "../../models/message.model.js";
import Chunk from "../../models/chunk.model.js";
import { sequelize } from "../../db/client.js";
import { QueryTypes } from "sequelize";
import { AppError } from "../../utils/AppError.js";

export const chatService = {
  async handleQuery(req) {
    const { question, conversationId: incomingConversationId } = req.body;
    const userId = req.userId;

    let conversation;
    let isNewConversation = false;
    let conversationId = incomingConversationId;

    // ── 1. conversation resolve ─────────────────────
    if (!conversationId) {
      isNewConversation = true;
      conversation = await Conversation.create({
        userId,
        title: "",
      });
      conversationId = conversation.conversationId;
    } else {
      conversation = await Conversation.findOne({
        where: { conversationId, userId },
      });

      if (!conversation) {
        throw new AppError("Conversation not found", 404);
      }
    }

    // ── 2. history BEFORE saving new message ────────
    const previousMessages = await Message.findAll({
      where: { conversationId },
      order: [["createdAt", "DESC"]],
      limit: 10,
    });

    const chatHistory = previousMessages
      .map(
        (m) =>
          `${m.role === "user" ? "User" : "Assistant"}: ${m.content.trim()}`
      )
      .join("\n");

    // ── 3. save user message ────────────────────────
    await Message.create({
      conversationId,
      role: "user",
      model: null,
      content: question,
    });

    // ── 4. embedding ────────────────────────────────
    const embedding = await generateEmbedding(question);

    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new AppError("Invalid embedding format", 500);
    }

    const results = await sequelize.query(
      `
      SELECT "chunkId", content
      FROM chunks
      WHERE "userId" = :userId
      ORDER BY embedding <=> :embedding::vector
      LIMIT 8
      `,
      {
        replacements: {
          userId,
          embedding: `[${embedding.join(",")}]`,
        },
        type: QueryTypes.SELECT,
      }
    );

    const chunkIds = results.map((r) => r.chunkId);

    const chunks = chunkIds.length
      ? await Chunk.findAll({
          where: { chunkId: chunkIds, userId },
        })
      : [];

    const orderedChunks = results
      .map((r) => chunks.find((c) => c.chunkId === r.chunkId))
      .filter(Boolean);

    const context = orderedChunks.length
      ? orderedChunks.map((c) => c.content.trim()).join("\n\n---\n\n")
      : "No relevant document context found.";

    // ── 5. LLM call ────────────────────────────────
    const answer = await this.callLLM(question, context, chatHistory);

    // ── 6. save assistant message ───────────────────
    await Message.create({
      conversationId,
      role: "assistant",
      model: "Qwen/Qwen2.5-7B-Instruct",
      content: answer,
    });

    // ── 7. title generation (only new chats) ────────
    let title = conversation.title;

    if (isNewConversation) {
      title = await this.generateTitle(question, answer);

      if (title) {
        await conversation.update({ title });
      }
    }

    return {
      answer,
      conversationId,
      title,
    };
  },

  // ────────────────────────────────────────────────
  async callLLM(question, context, chatHistory) {
    const response = await fetch(
      "https://router.huggingface.co/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.HF_TOKEN}`,
        },
        body: JSON.stringify({
          model: "Qwen/Qwen2.5-7B-Instruct",
          messages: [
            {
              role: "system",
              content: `
You are a RAG assistant.

RULES:
- Use ONLY context + chat history
- No hallucination
- Be concise and accurate
              `.trim(),
            },
            {
              role: "user",
              content: `
${chatHistory ? `CHAT HISTORY:\n${chatHistory}\n` : ""}
CONTEXT:
${context}

QUESTION:
${question}
              `.trim(),
            },
          ],
          temperature: 0.4,
          max_tokens: 512,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(await response.text());
    }

    const data = await response.json();

    return (
      data?.choices?.[0]?.message?.content ||
      "No response from model"
    );
  },

  // ────────────────────────────────────────────────
  async generateTitle(question, answer) {
    const res = await fetch(
      "https://router.huggingface.co/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.HF_TOKEN}`,
        },
        body: JSON.stringify({
          model: "Qwen/Qwen2.5-7B-Instruct",
          messages: [
            {
              role: "system",
              content:
                "Generate a short title (max 6 words). No markdown.",
            },
            {
              role: "user",
              content: `Q: ${question}\nA: ${answer}`,
            },
          ],
          temperature: 0.2,
          max_tokens: 20,
        }),
      }
    );

    if (!res.ok) return "";

    const data = await res.json();
    return data?.choices?.[0]?.message?.content?.trim() || "";
  },

  async getAllConversations(userId) {
    return await Conversation.findAll({
      where: { userId },
      attributes: ["conversationId", "title"],
      order: [["createdAt", "DESC"]],
    });
  },

  async getConversation(userId, conversationId) {
    const conversation = await Conversation.findOne({
      where: { conversationId, userId },
      include: {
        model: Message,
        attributes: ["role", "content"],
      },
      order: [[Message, "createdAt", "ASC"]],
    });

    if (!conversation) {
      throw new AppError("Conversation not found", 404);
    }

    return conversation;
  },
};