// utils/translateQuery.js
export async function translateQuery(question) {
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
            role: "user",
            content: `Detect the language of the documents and translate 
the following question into that same language.
Return ONLY the translated question, nothing else.

Question: ${question}`,
          },
        ],
        temperature: 0.1,
        max_tokens: 100,
      }),
    }
  );

  const data = await response.json();
  return data?.choices?.[0]?.message?.content?.trim() || question;
}