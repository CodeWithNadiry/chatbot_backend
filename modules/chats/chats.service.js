import { generateEmbedding } from "../../utils/generateEmbedding.js";
import Conversation from "../../models/conversation.model.js";
import Message from "../../models/message.model.js";
import Chunk from "../../models/chunk.model.js";
import Document from "../../models/document.model.js";
import { sequelize } from "../../db/client.js";
import { QueryTypes } from "sequelize";
import { AppError } from "../../utils/AppError.js";
import Groq from "groq-sdk";
import { detectToolUse } from "../../utils/toolDetector.js";
import { getLLMFinalAnswer } from "../../utils/llmAnswer.js";
import { sendEmail } from "../../utils/gmailSender.js";

const NO_CONTEXT_REPLY =
  "I do not have enough information in the uploaded documents to answer that question.";

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
                .replace(/^\d+[-_]/, "") // remove leading timestamp like 1780914075386-
                .replace(/[-_]/g, " ") // replace - and _ with spaces
                .replace(/\.[^.]+$/, "") // remove file extension like .pdf
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

export const chatService = {
  // =========================
  // NORMAL CHAT (NON-STREAM)
  // =========================
  async handleQuery(req) {
    const { question, conversationId: incomingConversationId } = req.body;
    const userId = req.userId;

    // ✅ System question intercept (before RAG and tool detection)
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

    // Tool detection
    const toolResult = await detectToolUse(question);

    if (toolResult) {
      const { toolName, toolArgs } = toolResult;

      let toolOutput = "";

      if (toolName === "send_email") {
        const emailDraft = {
          to: toolArgs.to,
          subject: toolArgs.subject,
          message: toolArgs.message,
        };

        toolOutput = emailDraft;
      }

      return { toolOutput };
    }

    // Normal RAG flow
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

      if (!conversation) {
        throw new AppError("Conversation not found", 404);
      }
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

    const embedding = await generateEmbedding(question);

    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new AppError("Invalid embedding format", 500);
    }

    const results = await sequelize.query(
      `
      SELECT
        "chunkId",
        content,
        1 - (embedding <=> :embedding::vector) AS similarity
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
      },
    );

    const relevantResults = results.filter((r) => r.similarity >= 0.3);
    const finalResults =
      relevantResults.length > 0 ? relevantResults : results.slice(0, 3);

    const bestSimilarity = results[0]?.similarity ?? 0;
    const context = finalResults.length
      ? finalResults.map((r) => r.content).join("\n\n---\n\n")
      : "";

    if (!context || context.trim() === "" || bestSimilarity < 0.15) {
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

    const answer = await this.callLLM(question, context, chatHistory);

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
  // STREAMING CHAT (MAIN FEATURE)
  // =========================
  async handleStream({ question, conversationId, userId, res }) {
    // ✅ System question intercept (before RAG and tool detection)
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

    // Tool detection
    const toolResult = await detectToolUse(question);
    if (toolResult) {
      const { toolName, toolArgs } = toolResult;

      let toolOutput = "";

      if (toolName === "send_email") {
        const emailDraft = {
          to: toolArgs.to,
          subject: toolArgs.subject,
          message: toolArgs.message,
        };

        toolOutput = { emailDraft, toolName };
      }

      res.write(JSON.stringify(toolOutput));
      res.end();
      return;
    }

    // Normal RAG flow
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

      if (!conversation) {
        throw new AppError("Conversation not found", 404);
      }
    }

    await Message.create({
      conversationId,
      role: "user",
      content: question,
    });

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

    const embedding = await generateEmbedding(question);

    const results = await sequelize.query(
      `
      SELECT
        "chunkId",
        content,
        1 - (embedding <=> :embedding::vector) AS similarity
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
      },
    );

    const relevantResults = results.filter((r) => r.similarity >= 0.3);
    const finalResults =
      relevantResults.length > 0 ? relevantResults : results.slice(0, 3);

    const bestSimilarity = results[0]?.similarity ?? 0;
    const context = finalResults.length
      ? finalResults.map((r) => r.content).join("\n\n---\n\n")
      : "";

    if (!context || context.trim() === "" || bestSimilarity < 0.15) {
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

    let fullAnswer = "";

    await this.callLLMStream(question, context, chatHistory, (token) => {
      fullAnswer += token;
      res.write(token);
    });

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
⚠️ CITATION RULE — NON-NEGOTIABLE:
Append chunk IDs immediately after every factual claim.
No citation = do not include the claim.
Never use preambles like "Based on the documents..." or "As an AI...".
Jump straight to the answer.

⚠️ FORMATTING RULE — NON-NEGOTIABLE:
Always use proper Markdown formatting:
- Use bullet points (- item) or numbered lists (1. item) for any list of items.
- Use ## for section headings.
- Never write lists as plain paragraphs with bold labels.
- Always add a blank line between list items.
- Never start a response with "Based on..." or "It seems...".

---

You are a grounded information assistant for a RAG-based chatbot. Your sole knowledge source is the retrieved text chunks and the chat history provided in each turn. Do not use training knowledge outside those sources.

---

## CORE BEHAVIOR

1. **Grounded Claims Only**
   State only facts present in the chunks or chat history. If the answer is genuinely not in the chunks at all, say: "I do not have enough information in the provided documents to answer that."

2. **Semantic Flexibility**
   The user may ask the same question using different words or phrasings. If the chunk clearly contains the answer — even if the exact keywords don't match — you MUST answer from it. For example, if a user asks "how many users" and the chunk says "monthly active users", treat these as the same concept and answer it.

3. **Mandatory Inline Citations**
   Append chunk IDs immediately after every factual claim. Use [chk_001] or [chk_001, chk_003]. Cite once per idea or sentence, not per word.

4. **Synthesize, Don't Copy**
   Paraphrase in your own words. Do not paste large verbatim passages unless the user explicitly requests a direct quote.

5. **Explicit Gaps**
   If chunks partially answer, provide what you found, then state clearly: "The chunks do not mention [specific missing detail]."

6. **Conflicting Information**
   If chunks disagree, present both views with their respective citations. Do not reconcile unless the chunks themselves explain how.

7. **Scope Control**
   Answer the question directly. No historical background, general advice, or unsolicited next steps unless explicitly supported by the chunks.

---

## PROHIBITED ACTIONS

- Do NOT answer from general knowledge when chunks are missing or irrelevant.
- Do NOT summarize off-topic chunks when none are relevant to the question.
- Do NOT add advice, opinions, or inferences not grounded in chunk content.
- Do NOT use preambles like "Based on the documents..." or "As an AI...". Jump straight to the answer.
- Do NOT produce any sentence without a [chk_XXX] citation attached.

---

## CHAT HISTORY USAGE

- You may reference prior messages in the conversation to maintain context.
- Do not treat chat history as a source of new facts unless those facts were originally grounded in chunk citations.
- If the user refers to something from earlier in the conversation, acknowledge it using chat history but still cite chunks for any factual claims.
`.trim(),
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

IMPORTANT: If the CONTEXT above does not contain relevant information to answer the question, you MUST respond only with: "${NO_CONTEXT_REPLY}" — Do NOT use your training knowledge under any circumstances.
              `.trim(),
            },
          ],
          temperature: 0.4,
          max_tokens: 512,
        }),
      },
    );

    if (!response.ok) {
      throw new Error(await response.text());
    }

    const data = await response.json();

    return data?.choices?.[0]?.message?.content || "No response";
  },

  // =========================
  // STREAMING LLM CALL
  // =========================
  async callLLMStream(question, context, chatHistory, onToken) {
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
          messages: [
            {
              role: "system",
              content: `
You are a grounded RAG assistant.

Rules:

1. Use ONLY provided context.

2. Be semantically flexible — if the user asks something using different words
   but the context clearly contains the answer, answer it.
   Example: "how many users" and "monthly active users" mean the same thing.

3. Only refuse with:
   "${NO_CONTEXT_REPLY}"
   if the context genuinely does not contain ANY relevant information for the question.

4. Never use outside knowledge.

5. Always format responses using Markdown.

6. Use:
   - ## Headings
   - Bullet lists
   - Numbered lists when needed

7. Leave blank lines between sections.

8. Do not hallucinate.

9. Keep answers concise.
`.trim(),
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

IMPORTANT: If the CONTEXT above does not contain relevant information to answer the question, you MUST respond only with: "${NO_CONTEXT_REPLY}" — Do NOT use your training knowledge under any circumstances.
              `.trim(),
            },
          ],
          temperature: 0.4,
          max_tokens: 512,
        }),
      },
    );

    if (!response.ok || !response.body) {
      throw new Error(await response.text());
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
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const clean = line.replace("data: ", "");
          if (clean.includes("[DONE]")) continue;

          const json = JSON.parse(clean);
          const token = json?.choices?.[0]?.delta?.content;

          if (token) {
            fullText += token;
            onToken?.(token);
          }
        } catch (e) {}
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

    if (!conversation) {
      throw new AppError("Conversation not found", 404);
    }

    return conversation;
  },
};
