import { config } from "dotenv";
import { Op } from "sequelize";

import { generateEmbedding } from "../../utils/generateEmbedding.js";
import Chunk from "../../models/chunk.model.js";
import Document from "../../models/document.model.js";
import { sequelize } from "../../db/client.js";
import Conversation from "../../models/conversation.model.js";
import Message from "../../models/message.model.js";

config();
export async function handleQuery(req, res, next) {
  try {
    let { question, conversationId, userId } = req.body;

    let conversation;
    let isNewConversation = false;

    if (!conversationId) {
      isNewConversation = true;

      conversation = await Conversation.create({
        userId: userId,
        title: "",
      });

      conversationId = conversation.conversationId;
    } else {
      conversation = await Conversation.findByPk(conversationId);
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

    // 4. Vector search
    const results = await sequelize.query(
      `
  SELECT "chunkId", content
  FROM chunks
  ORDER BY embedding <=> $1::vector
  LIMIT 8
  `,
      {
        bind: [`[${embedding.join(",")}]`],
        type: sequelize.QueryTypes.SELECT,
      },
    );

    const chunks = await Chunk.findAll({
      where: {
        chunkId: results.map((r) => r.chunkId),
      },
    });
    // 6. ORDER WITHOUT MAP (simple but correct)
    const orderedChunks = results
      .map((r) => chunks.find((c) => c.chunkId === r.chunkId))
      .filter(Boolean);

    const context = orderedChunks?.length
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

    // 6. Call LLM for answer
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
- If context is partially relevant, try to answer using it.
- If no relevant context exists, say: "I don't have enough information in the documents."
- Do NOT hallucinate facts outside context.
- Be concise and helpful.

IMPORTANT:
- Even if context is weak, try to extract meaning instead of refusing immediately.
- Combine CHAT HISTORY + CONTEXT when needed.

CHAT HISTORY:
- Use it for continuity and follow-up understanding.

OUTPUT:
- Clear, helpful, natural answers
`,
            },
            {
              role: "user",
              content: `CHAT HISTORY:
                        ${chatHistory}
                        
                        CONTEXT:
                        ${context}
                        
                        CURRENT QUESTION:
                        ${question}`,
            },
          ],
          temperature: 0.4,
          max_tokens: 512,
        }),
      },
    );

    if (!hfResponse.ok) {
      throw new Error("Error from model API");
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

    // 8. Generate title ONLY ON FIRST MESSAGE
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
                  "Generate a short title (max 6 words) from question and answer. No punctuation. No quotes.",
              },
              {
                role: "user",
                content: `Question: ${question}\nAnswer: ${answer}`,
              },
            ],
            temperature: 0.2,
          }),
        },
      );

      const titleData = await hfTitleResponse.json();

      title = titleData?.choices?.[0]?.message?.content?.trim() || "";

      await conversation.update({ title });
    }

    // 9. Return response
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
  try {
    const conversations = await Conversation.findAll({
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
    const { id: conversationId } = req.params;

    const conversation = await Conversation.findByPk(conversationId, {
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
