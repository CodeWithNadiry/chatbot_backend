import { Router } from "express";
import { validateRequest } from "../../middleware/validateRequest.js";
import { deleteDoc, getAll, ingest } from "./documents.controller.js";
import { upload } from "../../middleware/upload.js";
import { uploadDocumentSchema } from "./documents.schema.js";
import { isAuth } from "../../middleware/isAuth.js";
const router = Router();

router.post(
  "/upload",
  upload.array("files"),
  validateRequest(uploadDocumentSchema),
  isAuth,
  ingest,
);

router.get('/', isAuth, getAll)

router.delete('/:documentId', isAuth, deleteDoc)

export default router;
