import { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Wraps an async Express route handler so a rejected promise (e.g. an unexpected database
 * error) is forwarded to Express's error-handling middleware instead of becoming an unhandled
 * promise rejection, which crashes the entire Node process for every connected user.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
