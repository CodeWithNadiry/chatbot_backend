import { Router } from "express";
import { getAuthUrl, handleCallback, disconnect, getStatus } from "./integrations.controller.js";
import { isAuth } from "../../middleware/isAuth.js";

const router = Router();

router.get("/google/url", isAuth, getAuthUrl);
router.get("/google/callback", handleCallback); // no isAuth — Google redirects here
router.delete("/google", isAuth, disconnect);
router.get("/google/status", isAuth, getStatus);

export default router;