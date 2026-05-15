import { documentService } from "./documents.service.js";

const { ingestDocuments, getAllDocuments, deleteDocument } = documentService;
export async function ingest(req, res, next) {
  try {
    const result = await ingestDocuments(req);

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function getAll(req, res, next) {
  try {
    const documents = await getAllDocuments(req.userId);

    res.status(200).json({ documents });
  } catch (error) {
    next(error);
  }
}

export async function deleteDoc(req, res, next) {
  try {
    const result = await deleteDocument(req.params.documentId);

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
