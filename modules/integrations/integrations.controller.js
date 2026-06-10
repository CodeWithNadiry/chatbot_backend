import { integrationService } from "./integrations.service.js";

export async function getAuthUrl(req, res, next) {
  try {
    const url = integrationService.getAuthUrl(req.userId);
    res.status(200).json({ url });
  } catch (error) {
    next(error);
  }
}

export async function handleCallback(req, res, next) {
  try {
    const { code, state: userId } = req.query;


    if (!userId) {
      return res.status(400).json({ message: "Missing userId in state" });
    }

    await integrationService.handleCallback(code, userId);
    res.redirect(`https://chatbot-frontend-kappa-mauve.vercel.app/conversations?gmail=connected`);
  } catch (error) {
    next(error);
  }
}

export async function disconnect(req, res, next) {
  try {
    await integrationService.disconnect(req.userId);
    res.status(200).json({ message: "Gmail disconnected" });
  } catch (error) {
    next(error);
  }
}

export async function getStatus(req, res, next) {
  try {
    const status = await integrationService.getStatus(req.userId);
    res.status(200).json(status);
  } catch (error) {
    next(error);
  }
}