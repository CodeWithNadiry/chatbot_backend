import { generateEmbedding } from "../../utils/generateEmbedding.js";
import Conversation from "../../models/conversation.model.js";
import Message from "../../models/message.model.js";
import Chunk from "../../models/chunk.model.js";
import Document from "../../models/document.model.js";
import { sequelize } from "../../db/client.js";
import { QueryTypes } from "sequelize";
import { AppError } from "../../utils/AppError.js";
import { detectToolUse } from "../../utils/toolDetector.js";
import { getLLMFinalAnswer } from "../../utils/llmAnswer.js";
import { sendEmail } from "../../utils/gmailSender.js";

const NO_CONTEXT_REPLY =
  "I do not have enough information in the uploaded documents to answer that question.";

// ==============================
// LANGUAGE DETECTION (lightweight)
// ==============================
async function detectLanguage(text) {
  // We ask the LLM to identify the language in one word.
  // Fallback to "English" if anything fails.
  try {
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
              content:
                "You are a language detector. Reply with ONLY the full English name of the language (e.g. English, German, French, Urdu, Arabic, Spanish, etc). No other text.",
            },
            {
              role: "user",
              content: `Detect the language of this text: "${text.slice(0, 200)}"`,
            },
          ],
          temperature: 0.0,
          max_tokens: 10,
        }),
      },
    );
    if (!response.ok) return "English";
    const data = await response.json();
    const lang = data?.choices?.[0]?.message?.content?.trim();
    return lang || "English";
  } catch {
    return "English";
  }
}

// ==============================
// QUERY EXPANSION FOR BETTER RECALL
// ==============================
async function expandQuery(question) {
  // Returns 2-3 alternative phrasings of the question to improve semantic search recall.
  try {
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
              content:
                'You are a query expansion assistant. Given a user question, return 2 alternative phrasings of the same question. Output ONLY a JSON array of strings, e.g. ["phrasing 1", "phrasing 2"]. No explanation.',
            },
            {
              role: "user",
              content: `Question: ${question}`,
            },
          ],
          temperature: 0.3,
          max_tokens: 100,
        }),
      },
    );
    if (!response.ok) return [question];
    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content?.trim() || "[]";
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const alternatives = JSON.parse(cleaned);
    if (Array.isArray(alternatives)) {
      return [question, ...alternatives];
    }
    return [question];
  } catch {
    return [question];
  }
}

// ==============================
// MULTI-QUERY VECTOR SEARCH
// ==============================
async function searchChunks(queries, userId) {
  // Embed all query variants and merge results, deduplicating by chunkId, keeping highest similarity.
  const seen = new Map(); // chunkId -> best result

  for (const q of queries) {
    const embedding = await generateEmbedding(q);
    if (!Array.isArray(embedding) || embedding.length === 0) continue;

    const results = await sequelize.query(
      `
      SELECT
        "chunkId",
        content,
        1 - (embedding <=> :embedding::vector) AS similarity
      FROM chunks
      WHERE "userId" = :userId
      ORDER BY embedding <=> :embedding::vector
      LIMIT 12
      `,
      {
        replacements: {
          userId,
          embedding: `[${embedding.join(",")}]`,
        },
        type: QueryTypes.SELECT,
      },
    );

    for (const row of results) {
      const existing = seen.get(row.chunkId);
      if (!existing || row.similarity > existing.similarity) {
        seen.set(row.chunkId, row);
      }
    }
  }

  // Sort merged results by similarity descending
  return Array.from(seen.values()).sort((a, b) => b.similarity - a.similarity);
}

// =========================
// SYSTEM QUESTION DETECTOR
// =========================
const SYSTEM_QUESTIONS = [
  "who are you",
  "what can you do for me",
  "what can you do",
  "what topics can you help me with",
  "what topics can you help with",
  "what can you help me with",
];

function isSystemQuestion(question) {
  const normalized = question
    .toLowerCase()
    .trim()
    .replace(/[?!.]+$/, "");
  return SYSTEM_QUESTIONS.some((q) => normalized.includes(q));
}

async function getSystemAnswer(question, userId) {
  const normalized = question
    .toLowerCase()
    .trim()
    .replace(/[?!.]+$/, "");

  if (normalized.includes("who are you")) {
    return `I am your personal AI assistant powered by a Retrieval-Augmented Generation (RAG) system. I can read and understand documents you upload and answer questions based on their content. I also have Gmail integration, so I can help you draft and send emails directly from the chat.`;
  }

  if (
    normalized.includes("what can you do") ||
    normalized.includes("what can you help me with")
  ) {
    return `Here is what I can do for you:\n\n- **Answer questions** based on the documents you have uploaded\n- **Search across multiple documents** and find relevant information\n- **Maintain conversation history** so you can ask follow-up questions\n- **Send emails** via Gmail — just tell me who to email, the subject, and the message\n- **Summarize, explain, and compare** content from your uploaded files`;
  }

  if (normalized.includes("what topics can you help")) {
    let docList = "";
    try {
      const docs = await Document.findAll({
        where: { userId },
        attributes: ["fileName"],
        order: [["createdAt", "DESC"]],
      });

      if (docs.length > 0) {
        docList =
          "\n\nHere are the documents you have uploaded:\n" +
          docs
            .map((d, i) => {
              const clean = d.fileName
                .replace(/^\d+[-_]/, "")
                .replace(/[-_]/g, " ")
                .replace(/\.[^.]+$/, "")
                .trim();
              return `${i + 1}. ${clean}`;
            })
            .join("\n");
      } else {
        docList =
          "\n\nYou have not uploaded any documents yet. Go to the **Documents** section to upload your files.";
      }
    } catch (e) {
      docList = "\n\nCould not retrieve your document list at this time.";
    }

    return `I can help you with any topics covered in your uploaded documents.${docList}\n\nJust ask me anything about them and I will find the answer for you.`;
  }

  return null;
}

// =========================
// SYSTEM PROMPT BUILDER
// =========================
function buildSystemPrompt(detectedLanguage) {
  return `
You are a strict RAG (Retrieval-Augmented Generation) assistant. You MUST follow every rule below without exception.

## ABSOLUTE RULE — KNOWLEDGE SOURCE
- You are FORBIDDEN from using ANY knowledge from your training data.
- You may ONLY use information that is explicitly present in the CONTEXT CHUNKS provided in the user message.
- If the answer is not clearly present in the context chunks, you MUST respond with this exact sentence and nothing else:
  "${NO_CONTEXT_REPLY}"
- This rule applies even if you "know" the answer from training — that knowledge is PROHIBITED here.

## ABSOLUTE RULE — LANGUAGE
- The user's question is written in: **${detectedLanguage}**
- You MUST write your ENTIRE response in **${detectedLanguage}**.
- Do NOT use English or any other language unless ${detectedLanguage} is English.
- If the user explicitly says "answer in [language]" in their question, use that language instead for this turn only.
- The language of the documents or context does NOT affect your response language — only the user's question language does.

## SEMANTIC FLEXIBILITY
- Match questions to context semantically, not just by exact keyword.
- Example: "how many users" and "monthly active users" refer to the same concept — answer it from context if present.

## FORMATTING
- Use Markdown: ## headings, bullet lists, numbered lists.
- Leave blank lines between sections.
- Keep answers concise and well-structured.
- Never write lists as plain paragraphs.

## STRICTLY PROHIBITED
- No hallucination or use of training knowledge.
- No preambles like "Based on the documents..." or "As an AI...".
- No unsolicited advice or opinions.
- No response without grounding in the provided context.
  `.trim();
}

export const chatService = {
  // =========================
  // NORMAL CHAT (NON-STREAM)
  // =========================
  async handleQuery(req) {
    const { question, conversationId: incomingConversationId } = req.body;
    const userId = req.userId;

    if (isSystemQuestion(question)) {
      const systemAnswer = await getSystemAnswer(question, userId);
      if (systemAnswer) {
        let conversation;
        let conversationId = incomingConversationId;

        if (!conversationId) {
          conversation = await Conversation.create({ userId, title: "" });
          conversationId = conversation.conversationId;
        } else {
          conversation = await Conversation.findOne({
            where: { conversationId, userId },
          });
        }

        await Message.create({
          conversationId,
          role: "user",
          model: null,
          content: question,
        });
        await Message.create({
          conversationId,
          role: "assistant",
          model: null,
          content: systemAnswer,
        });

        const title = await this.generateTitle(question, systemAnswer);
        if (title) await conversation.update({ title });

        return { answer: systemAnswer, conversationId, title };
      }
    }

    const toolResult = await detectToolUse(question);

    if (toolResult) {
      const { toolName, toolArgs } = toolResult;
      if (toolName === "send_email") {
        return {
          toolOutput: {
            emailDraft: {
              to: toolArgs.to,
              subject: toolArgs.subject,
              message: toolArgs.message,
            },
            toolName,
          },
        };
      }
    }

    let conversation;
    let isNewConversation = false;
    let conversationId = incomingConversationId;

    if (!conversationId) {
      isNewConversation = true;
      conversation = await Conversation.create({ userId, title: "" });
      conversationId = conversation.conversationId;
    } else {
      conversation = await Conversation.findOne({
        where: { conversationId, userId },
      });
      if (!conversation) throw new AppError("Conversation not found", 404);
    }

    const previousMessages = await Message.findAll({
      where: { conversationId },
      order: [["createdAt", "DESC"]],
      limit: 10,
    });

    const chatHistory = previousMessages
      .map(
        (m) =>
          `${m.role === "user" ? "User" : "Assistant"}: ${m.content.trim()}`,
      )
      .join("\n");

    await Message.create({
      conversationId,
      role: "user",
      model: null,
      content: question,
    });

    // Detect language and expand query in parallel
    const [detectedLanguage, queries] = await Promise.all([
      detectLanguage(question),
      expandQuery(question),
    ]);

    const results = await searchChunks(queries, userId);
    const bestSimilarity = results[0]?.similarity ?? 0;

    // FIX: raised threshold from 0.15 to 0.4 to prevent training-knowledge leakage
    if (!results.length || bestSimilarity < 0.4) {
      await Message.create({
        conversationId,
        role: "assistant",
        model: "Qwen/Qwen2.5-7B-Instruct",
        content: NO_CONTEXT_REPLY,
      });

      let title = conversation.title;
      if (isNewConversation) {
        title = await this.generateTitle(question, NO_CONTEXT_REPLY);
        if (title) await conversation.update({ title });
      }

      return { answer: NO_CONTEXT_REPLY, conversationId, title };
    }

    // FIX: lowered relevance filter from 0.3 to 0.25 for better semantic recall
    const relevantResults = results.filter((r) => r.similarity >= 0.25);
    const finalResults =
      relevantResults.length > 0 ? relevantResults : results.slice(0, 3);
    const context = finalResults.map((r) => r.content).join("\n\n---\n\n");

    const answer = await this.callLLM(
      question,
      context,
      chatHistory,
      detectedLanguage,
    );

    await Message.create({
      conversationId,
      role: "assistant",
      model: "Qwen/Qwen2.5-7B-Instruct",
      content: answer,
    });

    let title = conversation.title;
    if (isNewConversation) {
      title = await this.generateTitle(question, answer);
      if (title) await conversation.update({ title });
    }

    return { answer, conversationId, title };
  },

  // =========================
  // STREAMING CHAT
  // =========================
  async handleStream({ question, conversationId, userId, res }) {
    if (isSystemQuestion(question)) {
      const systemAnswer = await getSystemAnswer(question, userId);
      if (systemAnswer) {
        let conversation;

        if (!conversationId) {
          conversation = await Conversation.create({ userId, title: "" });
          conversationId = conversation.conversationId;
        } else {
          conversation = await Conversation.findOne({
            where: { conversationId, userId },
          });
        }

        await Message.create({
          conversationId,
          role: "user",
          content: question,
        });
        await Message.create({
          conversationId,
          role: "assistant",
          model: null,
          content: systemAnswer,
        });

        const title = await chatService.generateTitle(question, systemAnswer);
        if (title) await conversation.update({ title });

        res.write(systemAnswer);
        res.end();
        return;
      }
    }

    const toolResult = await detectToolUse(question);
    if (toolResult) {
      const { toolName, toolArgs } = toolResult;
      if (toolName === "send_email") {
        // create conversation now so handleEmail reuses it
        let conversation;
        if (!conversationId) {
          conversation = await Conversation.create({ userId, title: "" });
          conversationId = conversation.conversationId;
        }

        await Message.create({
          conversationId,
          role: "user",
          content: question,
        });

        res.write(
          JSON.stringify({
            emailDraft: {
              to: toolArgs.to,
              subject: toolArgs.subject,
              message: toolArgs.message,
            },
            toolName,
            conversationId, // ← send this to frontend
          }),
        );
      }
      res.end();
      return;
    }

    let conversation;
    let isNew = false;

    if (!conversationId) {
      isNew = true;
      conversation = await Conversation.create({ userId, title: "" });
      conversationId = conversation.conversationId;
    } else {
      conversation = await Conversation.findOne({
        where: { conversationId, userId },
      });
      if (!conversation) throw new AppError("Conversation not found", 404);
    }

    await Message.create({ conversationId, role: "user", content: question });

    const previousMessages = await Message.findAll({
      where: { conversationId },
      order: [["createdAt", "DESC"]],
      limit: 10,
    });

    const chatHistory = previousMessages
      .map(
        (m) =>
          `${m.role === "user" ? "User" : "Assistant"}: ${m.content.trim()}`,
      )
      .join("\n");

    // Detect language and expand query in parallel
    const [detectedLanguage, queries] = await Promise.all([
      detectLanguage(question),
      expandQuery(question),
    ]);

    const results = await searchChunks(queries, userId);
    const bestSimilarity = results[0]?.similarity ?? 0;

    // FIX: raised threshold from 0.15 to 0.4
    if (!results.length || bestSimilarity < 0.4) {
      await Message.create({
        conversationId,
        role: "assistant",
        model: "Qwen/Qwen2.5-7B-Instruct",
        content: NO_CONTEXT_REPLY,
      });

      if (isNew) {
        const title = await this.generateTitle(question, NO_CONTEXT_REPLY);
        if (title) await conversation.update({ title });
      }

      res.write(NO_CONTEXT_REPLY);
      res.end();
      return;
    }

    // FIX: lowered relevance filter from 0.3 to 0.25
    const relevantResults = results.filter((r) => r.similarity >= 0.25);
    const finalResults =
      relevantResults.length > 0 ? relevantResults : results.slice(0, 3);
    const context = finalResults.map((r) => r.content).join("\n\n---\n\n");

    let fullAnswer = "";

    await this.callLLMStream(
      question,
      context,
      chatHistory,
      detectedLanguage,
      (token) => {
        fullAnswer += token;
        res.write(token);
      },
    );

    await Message.create({
      conversationId,
      role: "assistant",
      model: "Qwen/Qwen2.5-7B-Instruct",
      content: fullAnswer,
    });

    if (isNew) {
      const title = await this.generateTitle(question, fullAnswer);
      if (title) await conversation.update({ title });
    }

    res.end();
    return fullAnswer;
  },

  async handleEmail(
    userId,
    to,
    subject,
    message,
    question,
    toolName,
    conversationId,
  ) {
    const output = await sendEmail(userId, { to, subject, message });
    const reply = await getLLMFinalAnswer(question, toolName, output);

    let conversation;
    if (!conversationId) {
      conversation = await Conversation.create({ userId, title: "" });
      conversationId = conversation.conversationId;
    } else {
      conversation = await Conversation.findOne({
        where: { conversationId, userId },
      });
    }

    await Message.create({ conversationId, role: "user", content: question });
    await Message.create({
      conversationId,
      role: "assistant",
      model: "groq",
      content: reply,
    });

    const title = await chatService.generateTitle(question, reply);
    if (title) await conversation.update({ title });

    return { reply, conversationId, title };
  },

  // =========================
  // NORMAL LLM CALL
  // =========================
  async callLLM(question, context, chatHistory, detectedLanguage) {
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
              // FIX: language is now injected into the system prompt directly
              content: buildSystemPrompt(detectedLanguage),
            },
            {
              role: "user",
              content: `
CHAT HISTORY:
${chatHistory}

CONTEXT CHUNKS (your ONLY allowed knowledge source):
${context}

QUESTION:
${question}

              `.trim(),
            },
          ],
          temperature: 0.3,
          max_tokens: 512,
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM request failed: ${errorText}`);
    }

    const data = await response.json();
    return data?.choices?.[0]?.message?.content || NO_CONTEXT_REPLY;
  },

  // =========================
  // STREAMING LLM CALL
  // =========================
  async callLLMStream(
    question,
    context,
    chatHistory,
    detectedLanguage,
    onToken,
  ) {
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
          stream: true,
          temperature: 0.3,
          max_tokens: 300, // ← lowered from 512
          frequency_penalty: 1.2,
          messages: [
            {
              role: "system",
              // FIX: language is now injected into the system prompt directly
              content: buildSystemPrompt(detectedLanguage),
            },
            {
              role: "user",
              content: `
CHAT HISTORY:
${chatHistory}

CONTEXT CHUNKS (your ONLY allowed knowledge source):
${context}

QUESTION:
${question}

              `.trim(),
            },
          ],
        }),
      },
    );

    if (!response.ok || !response.body) {
      const errorText = await response.text();
      throw new Error(`LLM stream request failed: ${errorText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data:")) continue;

        const clean = trimmed.slice(5).trim();
        if (clean === "[DONE]") continue;

        try {
          const json = JSON.parse(clean);
          const token = json?.choices?.[0]?.delta?.content;
          if (token) {
            fullText += token;
            onToken?.(token);
          }
        } catch {
          // skip malformed SSE lines
        }
      }
    }

    return fullText;
  },

  // =========================
  // TITLE GENERATION
  // =========================
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
              content: "Generate a short title (max 6 words). No markdown.",
            },
            {
              role: "user",
              content: `Q: ${question}\nA: ${answer}`,
            },
          ],
          temperature: 0.2,
          max_tokens: 20,
        }),
      },
    );

    if (!res.ok) return "";
    const data = await res.json();
    return data?.choices?.[0]?.message?.content?.trim() || "";
  },

  // =========================
  // CONVERSATIONS
  // =========================
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
      order: [[Message, "createdAt", "DESC"]],
    });

    if (!conversation) throw new AppError("Conversation not found", 404);
    return conversation;
  },
};
