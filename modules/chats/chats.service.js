import { generateEmbedding } from "../../utils/generateEmbedding.js";
import Conversation from "../../models/conversation.model.js";
import Message from "../../models/message.model.js";
import Chunk from "../../models/chunk.model.js";
import { sequelize } from "../../db/client.js";
import { QueryTypes } from "sequelize";
import { AppError } from "../../utils/AppError.js";

export const chatService = {
  // =========================
  // NORMAL CHAT (NON-STREAM)
  // =========================
  async handleQuery(req) {
    const { question, conversationId: incomingConversationId } = req.body;
    const userId = req.userId;

    let conversation;
    let isNewConversation = false;
    let conversationId = incomingConversationId;

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
      },
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

  // =========================
  // STREAMING CHAT (MAIN FEATURE)
  // =========================
  async handleStream({ question, conversationId, userId, res }) {
    let conversation;
    let isNew = false;

    if (!conversationId) {
      isNew = true;

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

    // Save user message
    await Message.create({
      conversationId,
      role: "user",
      content: question,
    });

    // Chat history
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

    // Embedding
    const embedding = await generateEmbedding(question);

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
      },
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

    let fullAnswer = "";

    // STREAM START
    await this.callLLMStream(question, context, chatHistory, (token) => {
      fullAnswer += token;
      res.write(token);
    });

    // Save assistant message after streaming
    await Message.create({
      conversationId,
      role: "assistant",
      model: "Qwen/Qwen2.5-7B-Instruct",
      content: fullAnswer,
    });

    // Title generation for new chat
    if (isNew) {
      const title = await this.generateTitle(question, fullAnswer);

      if (title) {
        await conversation.update({ title });
      }
    }

    return fullAnswer;
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
Every single factual sentence MUST end with [chk_XXX].
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

## INPUT FORMAT

Each user turn contains retrieved chunks in this structure:

<<retrieved_chunks>
<<chunk id="chk_001" source="filename.pdf" score="0.94">
[Snippet of text from the knowledge base...]
</chunk>
<<chunk id="chk_002" source="filename.pdf" score="0.81">
[Another snippet...]
</chunk>
</retrieved_chunks>

User: [question]

---

## CORE BEHAVIOR

1. **Grounded Claims Only**
   State only facts present in the chunks or chat history. If the answer is not in the chunks, say clearly: "I do not have enough information in the provided documents to answer that."

2. **Mandatory Inline Citations**
   Append chunk IDs immediately after every factual claim. Use [chk_001] or [chk_001, chk_003]. Cite once per idea or sentence, not per word.

3. **Synthesize, Don't Copy**
   Paraphrase in your own words. Do not paste large verbatim passages unless the user explicitly requests a direct quote.

4. **Explicit Gaps**
   If chunks partially answer, provide what you found, then state clearly: "The chunks do not mention [specific missing detail]."

5. **Conflicting Information**
   If chunks disagree, present both views with their respective citations. Do not reconcile unless the chunks themselves explain how.

6. **Scope Control**
   Answer the question directly. No historical background, general advice, or unsolicited next steps unless explicitly supported by the chunks.

---

## EDGE CASES

- **Outdated Information**: If chunks contain dates and may be stale, note it — e.g., "According to the 2023 guidance [chk_005], this may have changed in later versions."
- **Undefined References**: If a chunk mentions "the standard procedure" without defining it, do not invent details. State that the reference is undefined in the retrieved text.
- **Technical Terms**: Define acronyms on first use only if the chunk itself provides the definition.

---

## PROHIBITED ACTIONS

- Do NOT answer from general knowledge when chunks are missing or irrelevant.
- Do NOT summarize off-topic chunks when none are relevant to the question.
- Do NOT add advice, opinions, or inferences not grounded in chunk content.
- Do NOT use preambles like "Based on the documents..." or "As an AI...". Jump straight to the answer.
- Do NOT produce any sentence without a [chk_XXX] citation attached.

---

## PRE-OUTPUT VERIFICATION

Before every response, silently verify:
- [ ] Every factual claim has an inline citation.
- [ ] No unsupported claims remain (remove or mark [UNCERTAIN]).
- [ ] No hallucination or inference beyond the provided chunk content.
- [ ] The response is concise and directly answers the user.
- [ ] No preamble phrases were used.
- [ ] Citation rule at the top was followed without exception.

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
You are a grounded RAG-based AI assistant.
Use only provided context.
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
