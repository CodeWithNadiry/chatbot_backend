import { chatService } from "./chats.service.js";

export async function handleQuery(req, res, next) {
  try {
    const result = await chatService.handleQuery(req);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function chatStream(req, res, next) {
  try {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Cache-Control", "no-cache");

    const { question, conversationId } = req.body;
    const userId = req.userId;

    await chatService.handleStream({
      question,
      conversationId,
      userId,
      res,
    });

    // DO NOT call res.end() here — handleStream does it after title is saved
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
    const result = await chatService.getConversation(
      req.userId,
      req.params.id,
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}