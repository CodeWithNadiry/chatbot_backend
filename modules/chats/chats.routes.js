import { Router } from "express";
import { get, getAll, handleQuery } from "./chat.controller.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { chatSchema } from "./chats.schema.js";
import { isAuth } from "../../middleware/isAuth.js";

const router = Router();

router.post("/query", isAuth, validateRequest(chatSchema), handleQuery);

router.get('/:id', isAuth, get);

router.get('/', isAuth, getAll)

export default router;
