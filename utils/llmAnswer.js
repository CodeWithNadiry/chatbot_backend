import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export async function getLLMFinalAnswer(question, toolName, toolOutput) {
  const finalResponse = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      { role: "user", content: question },
      {
        role: "assistant",
        content: `Tool ${toolName} was executed. Result: ${toolOutput}`,
      },
    ],
  });

  const reply = finalResponse.choices[0].message.content;

  return reply;
}
