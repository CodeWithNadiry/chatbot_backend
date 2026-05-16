import { documentService } from "./documents.service.js";

export async function ingest(req, res, next) {
  try {
    const result = await documentService.ingestDocuments(req);

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function getAll(req, res, next) {
  try {
    const documents = await documentService.getAllDocuments(req.userId);

    res.status(200).json({ documents });
  } catch (error) {
    next(error);
  }
}

export async function deleteDoc(req, res, next) {
  try {
    const result = await documentService.deleteDocument(req.params.documentId);

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
