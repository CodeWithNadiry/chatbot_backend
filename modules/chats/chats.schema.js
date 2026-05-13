import z from "zod";

export const chatSchema = z.object({
  question: z.string(),
  conversationId: z.string().uuid().optional(),
})