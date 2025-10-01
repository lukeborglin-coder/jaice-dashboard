import jwt from 'jsonwebtoken';

// Keep JWT secret consistent with auth.routes.mjs so tokens verify correctly
const JWT_SECRET = process.env.JWT_SECRET || 'jaice-dashboard-secret-key-change-in-production';

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
