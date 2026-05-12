import z from "zod";

export const uploadDocumentSchema = z.object({
  chunkSize: z.coerce.number().int().positive(),
  chunkOverlap: z.coerce.number().int().nonnegative(),
})