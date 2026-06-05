import { Router } from "express";
import { chatStream, get, getAll, handleQuery, sendFinalEmail } from "./chat.controller.js";

import { validateRequest } from "../../middleware/validateRequest.js";
import { chatSchema } from "./chats.schema.js";
import { isAuth } from "../../middleware/isAuth.js";

const router = Router();

// normal chat
router.post("/query", isAuth, validateRequest(chatSchema), handleQuery);

// streaming chat
router.post("/stream", isAuth, chatStream);

router.post('/sendEmail', isAuth, sendFinalEmail)
// conversations
router.get("/:id", isAuth, get);
router.get("/", isAuth, getAll);

export default router;
