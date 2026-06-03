import { Router } from "express";
import authRoutes from "../modules/auth/auth.routes.js";
import documentRoutes from '../modules/documents/documents.routes.js'
import chatRoutes from '../modules/chats/chats.routes.js'
import integrationRoutes from '../modules/integrations/integrations.routes.js'

const router = Router();

router.use("/auth", authRoutes);

router.use('/documents', documentRoutes)

router.use('/chats', chatRoutes)
router.use('/integrations', integrationRoutes)
export default router;

// req.body.chunkSize
// append(key, value) means:

// formData.append("name", "Usman")
// filesRef.current.files gives all selected files.