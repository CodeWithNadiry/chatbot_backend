import fs from "fs";
import mammoth from "mammoth";
import { extractText as extractPdfText } from "unpdf";

export async function extractText(file) {
  if (file.mimetype === "application/pdf") {
    const dataBuffer = fs.readFileSync(file.path);
    const { text } = await extractPdfText(new Uint8Array(dataBuffer));
    return Array.isArray(text) ? text.join("\n") : text;
  }

  if (
    file.mimetype ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const result = await mammoth.extractRawText({ path: file.path });
    return result.value;
  }

  if (file.mimetype === "text/plain") {
    return fs.readFileSync(file.path, "utf-8");
  }

  throw new Error("Unsupported file type");
}