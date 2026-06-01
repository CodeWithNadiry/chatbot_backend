import fs from "fs";
import mammoth from "mammoth";
import { extractText as extractPdfText } from "unpdf";

export async function extractText(file) {

  if (file.mimetype === "application/pdf") {
    const dataBuffer = await fs.promises.readFile(file.path);

    const { text } = await extractPdfText(
      new Uint8Array(dataBuffer)
    );

    return Array.isArray(text)
      ? text.join("\n")
      : text;
  }

  if (
    file.mimetype ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const { value } = await mammoth.extractRawText({
      path: file.path,
    });

    return value;
  }

  if (file.mimetype === "text/plain") {
    return await fs.promises.readFile(file.path, "utf8");
  }

  throw new Error("Unsupported file type");
}

// mimetype ==> The type of file being uploaded
// Multipurpose Internet Mail Extensions

// file	MIME Type
// pdf	application/pdf
// txt	text/plain
// docx	application/vnd.openxmlformats-officedocument.wordprocessingml.document
// png	image/png
// jpg	image/jpeg
// json	application/json

// Why MIME Types Exist

// When a file is uploaded, the server needs to know:

// Is this an image?
// PDF?
// Text?
// Video?

// So the browser sends metadata like:

// Content-Type: application/pdf

// ============================================>>>>>>>>>

// file object:

// When using Multer, uploaded file object contains:

// {
//   originalname: "resume.pdf",
//   mimetype: "application/pdf",
//   path: "uploads/abc.pdf"
// }

// ============================================>>>>>>>>>

// After PDF extraction:

// const { text } = await extractPdfText(...)

// sometimes text can be:

// CASE 1 — Array
// [
//   "Page 1 content",
//   "Page 2 content",
//   "Page 3 content"
// ]

// Some PDF libraries return one string per page.

// CASE 2 — Single String
// "My whole PDF content"

// Some libraries return all text already merged.

// Problem

// Your function wants to ALWAYS return:

// single string

// So you handle both cases.
