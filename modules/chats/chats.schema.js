import z from "zod";

export const chatSchema = z.object({
  question: z.string(),
  userId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
})