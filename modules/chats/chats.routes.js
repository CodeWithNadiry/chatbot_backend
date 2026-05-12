import { Router } from "express";
import { get, getAll, handleQuery } from "./chat.controller.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { chatSchema } from "./chats.schema.js";

const router = Router();

router.post("/query", validateRequest(chatSchema), handleQuery);

router.get('/:id', get);

router.get('/', getAll)

export default router;
