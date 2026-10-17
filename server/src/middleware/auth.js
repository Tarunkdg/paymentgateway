import jwt from 'jsonwebtoken';
import { HttpError } from './errors.js';

export function requireAdmin(req, _res, next) {
  const token = req.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return next(new HttpError(401, 'Administrator authentication is required.'));
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'local-demo-secret-change-me');
    if (payload.role !== 'admin') throw new Error('Invalid role');
    req.admin = payload;
    return next();
  } catch {
    return next(new HttpError(401, 'Your administrator session is invalid or expired.'));
  }
}
