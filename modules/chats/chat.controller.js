import { config } from "dotenv";
import { generateEmbedding } from "../../utils/generateEmbedding.js";
import Chunk from "../../models/chunk.model.js";
import Document from "../../models/document.model.js";
import { sequelize } from "../../db/client.js";
import Conversation from "../../models/conversation.model.js";
import Message from "../../models/message.model.js";
import { QueryTypes } from "sequelize";

config();

export async function handleQuery(req, res, next) {
  try {
    const { question, conversationId: incomingConversationId } = req.body;
    const userId = req.userId;

    let conversation;
    let isNewConversation = false;
    let conversationId = incomingConversationId;

    // ── 1. Resolve or create conversation ──────────────────────────────────
    if (!conversationId) {
      isNewConversation = true;
      conversation = await Conversation.create({ userId, title: "" });
      conversationId = conversation.conversationId;
    } else {
      conversation = await Conversation.findOne({
        where: { conversationId, userId },
      });
      if (!conversation) {
        return res.status(404).json({ message: "Conversation not found" });
      }
    }

    // ── 2. Fetch PREVIOUS history BEFORE saving the new user message ────────
    //    FIX: was fetching history AFTER saving, so the current question was
    //    always included in chatHistory, causing it to appear twice in the prompt.
    const previousMessages = await Message.findAll({
      where: { conversationId },
      order: [["createdAt", "DESC"]],
      limit: 10, // last 10 messages (5 turns) for context
    });

    const chatHistory = previousMessages
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.trim()}`)
      .join("\n");

    // ── 3. Save the new user message ────────────────────────────────────────
    await Message.create({
      conversationId,
      role: "user",
      model: null,
      content: question,
    });

    // ── 4. Generate embedding & retrieve relevant chunks ───────────────────
    const embedding = await generateEmbedding(question);

    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error("Invalid embedding format");
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
      ? await Chunk.findAll({ where: { chunkId: chunkIds, userId } })
      : [];

    // Preserve similarity order returned by pgvector
    const orderedChunks = results
      .map((r) => chunks.find((c) => c.chunkId === r.chunkId))
      .filter(Boolean);

    // FIX: trim each chunk to avoid whitespace noise in context
    const context = orderedChunks.length
      ? orderedChunks.map((c) => c.content.trim()).join("\n\n---\n\n")
      : "No relevant document context found.";

    // ── 5. Call the LLM ────────────────────────────────────────────────────
    const hfResponse = await fetch(
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
              // FIX: explicitly tell the model to avoid markdown so the
              // frontend receives clean plain text without ** ## `` etc.
              content: `
You are an intelligent RAG-based assistant.

STRICT RULES:
- Use ONLY the provided CONTEXT and CHAT HISTORY to answer.
- If no relevant context exists, say: "I don't have enough information in the documents."
- Do NOT hallucinate or add facts outside the context.
- Be concise, accurate, and helpful.

FORMATTING RULES (VERY IMPORTANT):
- Reply in plain text only. NO markdown whatsoever.
- Do NOT use ** for bold, * for italic, # for headings, or backticks for code.
- Do NOT use bullet points with -, *, or numbered lists unless absolutely necessary.
- Write in clear, natural sentences and paragraphs.
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

    if (!hfResponse.ok) {
      const errText = await hfResponse.text();
      throw new Error(`HuggingFace API error: ${errText}`);
    }

    const data = await hfResponse.json();

    const answer =
      data?.choices?.[0]?.message?.content?.trim() ||
      data?.generated_text ||
      "No response from model";

    // ── 6. Save assistant message ──────────────────────────────────────────
    await Message.create({
      conversationId,
      role: "assistant",
      model: "Qwen/Qwen2.5-7B-Instruct",
      content: answer,
    });

    // ── 7. Generate title for new conversations ────────────────────────────
    let title = conversation.title;

    if (isNewConversation) {
      const hfTitleResponse = await fetch(
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
                // FIX: added max_tokens so title cannot be excessively long
                content:
                  "Generate a short conversation title (maximum 6 words). Plain text only. No punctuation. No markdown.",
              },
              {
                role: "user",
                content: `Question: ${question}\nAnswer: ${answer}`,
              },
            ],
            temperature: 0.2,
            max_tokens: 20, // FIX: was missing — title could be very long
          }),
        }
      );

      if (hfTitleResponse.ok) {
        const titleData = await hfTitleResponse.json();
        title = titleData?.choices?.[0]?.message?.content?.trim() || "";
        await conversation.update({ title });
      }
    }

    return res.json({ answer, conversationId, title });
  } catch (error) {
    next(error);
  }
}

export async function getAll(req, res, next) {
  try {
    const userId = req.userId;

    const conversations = await Conversation.findAll({
      where: { userId },
      attributes: ["conversationId", "title"],
      order: [["createdAt", "DESC"]],
    });

    res.status(200).json({ conversations });
  } catch (error) {
    next(error);
  }
}

export async function get(req, res, next) {
  try {
    const userId = req.userId;
    const { id: conversationId } = req.params;

    const conversation = await Conversation.findOne({
      where: { conversationId, userId },
      include: {
        model: Message,
        attributes: ["role", "content"],
      },
      // FIX: was DESC — messages should be in chronological (ASC) order
      order: [[Message, "createdAt", "ASC"]],
    });

    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    return res.status(200).json(conversation);
  } catch (error) {
    next(error);
  }
}