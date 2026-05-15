import { chatService } from "./chats.service.js";

export async function handleQuery(req, res, next) {
  try {
    const result = await chatService.handleQuery(req);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function getAll(req, res, next) {
  try {
    const result = await chatService.getAllConversations(req.userId);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function get(req, res, next) {
  try {
    const result = await chatService.getConversation(req.userId, req.params.id);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
