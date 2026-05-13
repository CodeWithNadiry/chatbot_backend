import { config } from "dotenv";
import { Op } from "sequelize";

import { generateEmbedding } from "../../utils/generateEmbedding.js";
import Chunk from "../../models/chunk.model.js";
import Document from "../../models/document.model.js";
import { sequelize } from "../../db/client.js";
import Conversation from "../../models/conversation.model.js";
import Message from "../../models/message.model.js";

config();
import { config } from "dotenv";
import { generateEmbedding } from "../../utils/generateEmbedding.js";
import Chunk from "../../models/chunk.model.js";
import Document from "../../models/document.model.js";
import { sequelize } from "../../db/client.js";
import Conversation from "../../models/conversation.model.js";
import Message from "../../models/message.model.js";

config();

export async function handleQuery(req, res, next) {
  try {
    const { question, conversationId } = req.body;
    const userId = req.userId;

    let conversation;
    let isNewConversation = false;

    if (!conversationId) {
      isNewConversation = true;

      conversation = await Conversation.create({
        userId,
        title: "",
      });

      conversationId = conversation.conversationId;
    } else {
      conversation = await Conversation.findOne({
        where: {
          conversationId,
          userId,
        },
      });

      if (!conversation) {
        return res.status(404).json({ message: "Conversation not found" });
      }
    }

    // 2. Save user message
    await Message.create({
      conversationId,
      role: "user",
      model: null,
      content: question,
    });

    // 3. Generate embedding
    const embedding = await generateEmbedding(question);

    if (!Array.isArray(embedding)) {
      throw new Error("Invalid embedding format");
    }

    // 4. VECTOR SEARCH (FIXED - CRITICAL)
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
        type: sequelize.QueryTypes.SELECT,
      }
    );

    const chunks = await Chunk.findAll({
      where: {
        chunkId: results.map((r) => r.chunkId),
        userId, // extra safety layer
      },
    });

    const orderedChunks = results
      .map((r) => chunks.find((c) => c.chunkId === r.chunkId))
      .filter(Boolean);

    const context = orderedChunks.length
      ? orderedChunks.map((c) => c.content).join("\n\n")
      : "No relevant document context found.";

    const lastMessagesHistory = await Message.findAll({
      where: { conversationId },
      order: [["createdAt", "DESC"]],
      limit: 5,
    });

    const chatHistory = lastMessagesHistory
      .reverse()
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    // 6. Call LLM
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
              content: `
You are an intelligent RAG-based assistant.

RULES:
- Use ONLY the provided CONTEXT and CHAT HISTORY.
- If no relevant context exists, say: "I don't have enough information in the documents."
- Do NOT hallucinate facts outside context.
- Be concise and helpful.
`,
            },
            {
              role: "user",
              content: `
CHAT HISTORY:
${chatHistory}

CONTEXT:
${context}

QUESTION:
${question}
`,
            },
          ],
          temperature: 0.4,
          max_tokens: 512,
        }),
      }
    );

    if (!hfResponse.ok) {
      const errText = await hfResponse.text();
      throw new Error(errText);
    }

    const data = await hfResponse.json();

    const answer =
      data?.choices?.[0]?.message?.content ||
      data?.generated_text ||
      "No response from model";

    // 7. Save assistant message
    await Message.create({
      conversationId,
      role: "assistant",
      model: "Qwen/Qwen2.5-7B-Instruct",
      content: answer,
    });

    // 8. Generate title (first message only)
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
                content:
                  "Generate a short title (max 6 words). No punctuation.",
              },
              {
                role: "user",
                content: `Question: ${question}\nAnswer: ${answer}`,
              },
            ],
            temperature: 0.2,
          }),
        }
      );

      const titleData = await hfTitleResponse.json();

      title =
        titleData?.choices?.[0]?.message?.content?.trim() || "";

      await conversation.update({ title });
    }

    return res.json({
      answer,
      conversationId,
      title,
    });
  } catch (error) {
    next(error);
  }
}

export async function getAll(req, res, next) {
  console.log("all conversation running");

  try {
    const userId = req.userId;
    console.log("userId", userId);
    const conversations = await Conversation.findAll({
      where: {
        userId,
      },
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
    console.log("userId:", req.userId);
    console.log("conversationId:", req.params.id);
    const conversation = await Conversation.findOne({
      where: {
        conversationId,
        userId,
      },
      include: {
        model: Message,
        attributes: ["role", "content"],
      },
      order: [[Message, "createdAt", "DESC"]],
    });

    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    return res.status(200).json(conversation);
  } catch (error) {
    next(error);
  }
}
