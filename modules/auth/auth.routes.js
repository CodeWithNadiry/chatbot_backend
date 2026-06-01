import { Router } from "express";
import { login, signup } from "./auth.controller.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { loginSchema, signupSchema } from "./auth.schema.js";

const router = Router();

router.post("/signup", validateRequest(signupSchema), signup);

// {
//   body: registerSchema
// }

router.post("/login", validateRequest(loginSchema), login);

export default router;
