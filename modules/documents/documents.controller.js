import { AppError } from "../../utils/AppError.js";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { extractText, getFileType } from "../../utils/extractText.js";
import Document from "../../models/document.model.js";
import { sequelize } from "../../db/client.js";
import { generateEmbedding } from "../../utils/generateEmbedding.js";

export async function ingest(req, res, next) {
  try {
    const files = req.files;
    let { chunkSize, chunkOverlap } = req.body;

    if (!files || files.length === 0) {
      throw new AppError("No files provided", 400);
    }

    const results = await Promise.all(
      files.map(async (file) => {
        let document;

        try {
          document = await Document.create({
            userId: req.userId,
            fileName: file.filename,
            filePath: file.path,
            fileType: getFileType(file.mimetype),
            status: "pending",
          });

          const text = await extractText(file);

          if (!text) {
            await document.update({ status: "failed" });
            throw new AppError("No text extracted from file", 400);
          }

          await document.update({ status: "processing" });

          const splitter = new RecursiveCharacterTextSplitter({
            chunkSize,
            chunkOverlap,
          });

          const chunks = await splitter.splitText(text);

          for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];

            const embedding = await generateEmbedding(chunk);

            if (!Array.isArray(embedding)) {
              throw new Error("Invalid embedding format");
            }

            await sequelize.query(
              `
              INSERT INTO chunks
              ("chunkId", "userId", "documentId", "chunkIndex", content, embedding, metadata)
              VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5::vector, $6)
              `,
              {
                bind: [
                  req.userId,
                  document.documentId,
                  i,
                  chunk,
                  `[${embedding.join(",")}]`,
                  {
                    chunkSize,
                    chunkOverlap,
                  },
                ],
              },
            );
          }

          await document.update({ status: "completed" });

          return document;
        } catch (error) {
          if (document) {
            await document.update({ status: "failed" });
          }
          throw error;
        }
      }),
    );

    res.status(200).json({
      message: `document${files.length > 1 ? "s" : ""} uploaded successfully!`,
      documents: results,
    });
  } catch (error) {
    next(error);
  }
}

export async function getAll(req, res, next) {
  try {
    const documents = await Document.findAll({ where: { userId: req.userId } });

    if (documents.length === 0) {
      throw new AppError("No documents found.", 404);
    }

    res.status(200).json({ documents });
  } catch (error) {
    next(error);
  }
}


export async function deleteDoc(req, res, next) {
  try {
    const { documentId } = req.params;

    console.log(documentId, 'documentId')
    const document = await Document.findByPk(documentId);

    if (!document) {
      throw new AppError("Document not found", 404);
    }

    await document.destroy();

    res.status(200).json({
      message: "Document deleted successfully",
    });
  } catch (error) {
    next(error);
  }
}