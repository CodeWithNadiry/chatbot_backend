import z from "zod";

export const uploadDocumentSchema = z.object({
  chunkSize: z.coerce.number().int().positive(), // z.coerce.number() converts "1" → 1
  chunkOverlap: z.coerce.number().int().nonnegative(),
})