import jwt from 'jsonwebtoken';
import { config } from 'dotenv';

// Load environment variables
config();

// Enforce JWT secret - fail if not set in production
if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set!');
  console.error('Please set JWT_SECRET in your .env file before starting the server.');
  process.exit(1);
}

const JWT_SECRET = process.env.JWT_SECRET;

export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Require user to be Cognitive company or Admin role
export const requireCognitiveOrAdmin = (req, res, next) => {
  try {
    const u = req.user || {};
    const isAdmin = u.role === 'admin';
    const isCognitive = u.company === 'Cognitive';
    if (isAdmin || isCognitive) return next();
    return res.status(403).json({ error: 'Access restricted. Company must be Cognitive.' });
  } catch (e) {
    return res.status(403).json({ error: 'Access restricted.' });
  }
};
