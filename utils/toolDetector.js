import Tool from "../models/tool.model.js";

export async function detectToolUse(question) {
  try {
    const tools = await Tool.findAll({ where: { enabled: true } });
    if (!tools.length) return null;

    const formattedTools = tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    // Detect language first
    const langResponse = await fetch(
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
                "Reply with ONLY the full English name of the language (e.g. English, German, Urdu). No other text.",
            },
            {
              role: "user",
              content: `Detect the language: "${question.slice(0, 200)}"`,
            },
          ],
          max_tokens: 10,
          temperature: 0.0,
        }),
      },
    );

    const langData = await langResponse.json();
    const detectedLanguage =
      langData?.choices?.[0]?.message?.content?.trim() || "English";

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
              content: `You are a helpful assistant.
If the user wants to send an email, use the send_email tool.
Otherwise do not use any tool.

When composing the email:
- The user's language is: ${detectedLanguage}
- You MUST write BOTH the subject and message in ${detectedLanguage}
- Do NOT translate to English under any circumstances
- Keep the message concise and natural (2-3 sentences max)
- Preserve the exact intention of the user
- Write the message as if the user wrote it themselves
- Generate a short relevant subject line in ${detectedLanguage}`,
            },
            { role: "user", content: question },
          ],
          tools: formattedTools,
          tool_choice: "auto",
        }),
      },
    );

    const data = await response.json();
    const message = data.choices[0].message;

    if (message.tool_calls && message.tool_calls.length > 0) {
      const toolCall = message.tool_calls[0];
      return {
        toolName: toolCall.function.name,
        toolArgs: JSON.parse(toolCall.function.arguments),
      };
    }

  } catch (error) {
    console.error("❌ detectToolUse crashed:", error);
    return null;
  }
}
