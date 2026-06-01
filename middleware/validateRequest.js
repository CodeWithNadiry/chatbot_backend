import { AppError } from "../utils/AppError.js";

export const validateRequest = (schemas) => {
  return (req, res, next) => {
    try {
      if (!schemas) throw new AppError("No schema provided", 500);

      // if single schema → treat as body
      const schemaMap = schemas.safeParse ? { body: schemas } : schemas;

      const { body, params, query } = schemaMap;

      if (body) {
        const result = body.safeParse(req.body);
        if (!result.success) {
          throw new AppError(result.error.flatten().fieldErrors, 422);
        }
        req.body = result.data; // in login controller, then we get ====>>>>>> const { email, password } = req.body;
      }

      if (params) {
        const result = params.safeParse(req.params);
        if (!result.success) {
          throw new AppError(result.error.flatten().fieldErrors, 422);
        }
        req.params = result.data;
      }

      if (query) {
        const result = query.safeParse(req.query);
        if (!result.success) {
          throw new AppError(result.error.flatten().fieldErrors, 422);
        }
        req.query = result.data;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
};
