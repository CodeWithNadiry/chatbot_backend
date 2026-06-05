import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export async function getLLMFinalAnswer(question, toolName, toolOutput) {
  const finalResponse = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      {
        role: "system",
        content: `You are a helpful assistant that confirms email actions.
You will be given the exact email that was sent.
Your job is to show the user exactly what was sent in this format:

✅ Email sent successfully!

**To:** [email]
**Subject:** [subject]
**Message:** [message]

Do not add anything else. Do not modify the content. Show exactly what was sent.`,
      },
      {
        role: "user",
        content: `The following email was just sent:
To: ${toolOutput.to}
Subject: ${toolOutput.subject}
Message: ${toolOutput.message}

Please confirm it to the user.`,
      },
    ],
  });

  return finalResponse.choices[0].message.content;
}
