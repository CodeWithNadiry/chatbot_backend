import { authService } from "./auth.service.js";

const { signupUser, loginUser } = authService;

export async function signup(req, res, next) {
  try {
    const result = await signupUser(req.body);

    return res
      .status(201)
      .json({ message: "User created successfully.", ...result });
  } catch (error) {
// error is    {
//   message: "Invalid credentials",
//   statusCode: 401
// }
    next(error);
  }
}

export async function login(req, res, next) {
  try {
    const result = await loginUser(req.body);
    res.status(200).json({ message: "user logged in successfully", ...result });
  } catch (error) {
    next(error);
  }
}
