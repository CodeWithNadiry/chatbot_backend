import Groq from "groq-sdk";
import Tool from "../models/tool.model.js";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export async function detectToolUse(question) {
  // Fetch enabled tools from DB
  const tools = await Tool.findAll({ where: { enabled: true } });

  if (!tools.length) return null;

  // Format tools for Groq
  const formattedTools = tools.map((t) => ({
    //this is exactly the format Groq expects for tool calling. It follows the OpenAI function calling format which Groq is compatible with.
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));

  const response = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      {
        role: "system",
        content: `You are a helpful assistant. 
If the user wants to send an email, use the send_email tool.
Otherwise do not use any tool.

When composing the email:
- Keep the message concise and natural (2-3 sentences max)
- Preserve the exact intention of the user
- Do not add unnecessary formal language
- Write the message as if the user wrote it themselves
- Generate a short relevant subject line`,
      },
      {
        role: "user",
        content: question,
      },
    ],
    tools: formattedTools,
    tool_choice: "auto",
  });

  const message = response.choices[0].message;

  // If LLM decided to use a tool
  if (message.tool_calls && message.tool_calls.length > 0) {
    const toolCall = message.tool_calls[0];
    return {
      toolName: toolCall.function.name,
      toolArgs: JSON.parse(toolCall.function.arguments), // arguments is a STRING not an object, that's why we put JSON.parse
    };
  }

  return null; // no tool use, proceed with RAG
}
