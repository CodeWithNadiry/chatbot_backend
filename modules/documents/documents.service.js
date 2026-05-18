import Document from "../../models/document.model.js";
import { sequelize } from "../../db/client.js";
import { generateEmbedding } from "../../utils/generateEmbedding.js";

import { getFileType } from "../../utils/getFileType.js";
import { splitText } from "../../lib/textSplitter.js";
import { AppError } from "../../utils/AppError.js";
import { extractText } from "../../lib/fileParse.js";
import { validate } from "../../utils/validators.js";

export const documentService = {
  async ingestDocuments(req) {
    const files = req.files;
    const userId = req.userId;

    validate(files);

    const results = await Promise.all(
  files.map(async (file) => {
    let document;

    try {
      document = await documentService.createDocument(file, userId);
      
      const text = await extractText(file);

      if (!text) {
        await document.update({ status: "failed" });
        return document;
      }

      await document.update({ status: "processing" });

      const chunks = await splitText(
        text,
        req.body.chunkSize || 1000,
        req.body.chunkOverlap || 200
      );

      const embeddings = await Promise.all(
        chunks.map((chunk) => generateEmbedding(chunk))
      );

      await Promise.all(
        chunks.map((chunk, index) =>
          sequelize.query(
            `
            INSERT INTO chunks
            ("userId", "documentId", "chunkIndex", content, embedding, metadata)
            VALUES ($1, $2, $3, $4, $5::vector, $6)
            `,
            {
              bind: [
                userId,
                document.documentId,
                index,
                chunk,
                `[${embeddings[index].join(",")}]`,
                {
                  chunkSize: req.body.chunkSize,
                  chunkOverlap: req.body.chunkOverlap,
                },
              ],
            }
          )
        )
      );

      await document.update({ status: "completed" });

      return document;
    } catch (err) {
      if (document) {
        await document.update({ status: "failed" });
        return document;
      }

      return {
        fileName: file.name,
        status: "failed",
      };
    }
  })
);

    return {
      message: `document${files.length > 1 ? "s" : ""} uploaded successfully`,
      documents: results,
    };
  },

  async createDocument(file, userId) {
    const { filename, path, mimetype } = file;

    return await Document.create({
      userId,
      fileName: filename,
      filePath: path,
      fileType: getFileType(mimetype),
      status: "pending",
    });
  },

  async getAllDocuments(userId) {
    return await Document.findAll({
      where: { userId },
      order: [["createdAt", "DESC"]],
    });
  },

  async deleteDocument(documentId) {
    const document = await Document.findByPk(documentId);

    if (!document) {
      throw new AppError("Document not found", 404);
    }

    await document.destroy();

    return {
      message: "Document deleted successfully",
    };
  },
};