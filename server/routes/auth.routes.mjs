import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

// Load environment variables
config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();

// Simple in-memory storage for demo (in production, use a real database)
let users = [];
let nextUserId = 1;

// Load users from file if it exists
const dataDir = process.env.DATA_DIR || join(__dirname, '../data');
const usersFile = join(dataDir, 'users.json');
try {
  if (fs.existsSync(usersFile)) {
    const data = fs.readFileSync(usersFile, 'utf8');
    users = JSON.parse(data);
    nextUserId = Math.max(...users.map(u => parseInt(u.id)), 0) + 1;
    
    // Migration: Add company field to existing users if missing
    let needsMigration = false;
    users.forEach(user => {
      if (!user.company) {
        user.company = 'None';
        needsMigration = true;
      }
      // Remove originalPassword if it exists (security cleanup)
      if (user.originalPassword) {
        delete user.originalPassword;
        needsMigration = true;
      }
    });
    
    if (needsMigration) {
      console.log('Migrating existing users to include original passwords...');
      saveUsers();
    }
  }
} catch (error) {
  console.log('No existing users file found, starting fresh');
}

// Save users to file
const saveUsers = () => {
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
  } catch (error) {
    console.error('Error saving users:', error);
  }
};

// Enforce JWT secret - fail if not set in production
if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set!');
  console.error('Please set JWT_SECRET in your .env file before starting the server.');
  process.exit(1);
}

const JWT_SECRET = process.env.JWT_SECRET;

// Authenticate token middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token provided' });
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Find user
    const user = users.find(u => u.id === decoded.userId);
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid token' });
  }
};

// Register endpoint
router.post('/register',
  [
    body('name')
      .trim()
      .isLength({ min: 1, max: 100 })
      .withMessage('Name must be between 1 and 100 characters')
      .escape(),
    body('email')
      .trim()
      .isEmail()
      .normalizeEmail()
      .withMessage('Valid email is required')
      .isLength({ max: 255 })
      .withMessage('Email must be less than 255 characters'),
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number')
  ],
  async (req, res) => {
    try {
      // Check validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ message: errors.array()[0].msg });
      }

      const { name, email, password } = req.body;

    // Check if user already exists
    const existingUser = users.find(user => user.email === email);
    if (existingUser) {
      return res.status(400).json({ message: 'User with this email already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const newUser = {
      id: nextUserId.toString(),
      name,
      email,
      password: hashedPassword,
      role: users.length === 0 ? 'admin' : 'user', // First user is admin
      company: 'None',
      createdAt: new Date().toISOString()
    };

    users.push(newUser);
    nextUserId++;
    saveUsers();

    // Generate JWT token
    const token = jwt.sign(
      { userId: newUser.id, email: newUser.email, role: newUser.role, company: newUser.company },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Return user without password
    const { password: _, ...userWithoutPassword } = newUser;

    res.status(201).json({
      message: 'User created successfully',
      user: userWithoutPassword,
      token
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Login endpoint
router.post('/login',
  [
    body('email')
      .trim()
      .isEmail()
      .normalizeEmail()
      .withMessage('Valid email is required'),
    body('password')
      .notEmpty()
      .withMessage('Password is required')
  ],
  async (req, res) => {
    try {
      // Check validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ message: errors.array()[0].msg });
      }

      const { email, password } = req.body;

    // Find user
    const user = users.find(user => user.email === email);
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Check password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role, company: user.company || 'None' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Return user without password
    const { password: _, ...userWithoutPassword } = user;

    res.json({
      message: 'Login successful',
      user: userWithoutPassword,
      token
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Verify token endpoint
router.get('/verify', (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Find user
    const user = users.find(u => u.id === decoded.userId);
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    // Return user without password
    const { password: _, ...userWithoutPassword } = user;

    res.json({
      user: userWithoutPassword,
      valid: true
    });
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(401).json({ message: 'Invalid token' });
  }
});

// Get all users (admin only)
router.get('/users', (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Check if user is admin
    const user = users.find(u => u.id === decoded.userId);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    // Return all users without passwords
    const usersWithoutPasswords = users.map(({ password, ...user }) => user);

    res.json({ users: usersWithoutPasswords });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Test endpoint without auth
router.get('/users/test', (req, res) => {
  try {
    console.log('Test endpoint hit');
    const { q } = req.query;
    console.log('Query:', q);
    
    const searchResults = users
      .filter(u => u.name.toLowerCase().includes((q || '').toLowerCase()))
      .map(({ password, ...user }) => user)
      .slice(0, 10);

    console.log('Test results:', searchResults);
    res.json({ users: searchResults });
  } catch (error) {
    console.error('Test endpoint error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Search users by name (for team member selection)
router.get('/users/search', (req, res) => {
  try {
    console.log('Search users endpoint hit');
    console.log('Query:', req.query);
    
    const authHeader = req.headers.authorization;
    console.log('Auth header:', authHeader ? 'Present' : 'Missing');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('No valid auth header');
      return res.status(401).json({ message: 'No token provided' });
    }

    const token = authHeader.substring(7);
    console.log('Token:', token.substring(0, 20) + '...');
    
    const decoded = jwt.verify(token, JWT_SECRET);
    console.log('Decoded token:', decoded);
    
    // Verify user exists
    const user = users.find(u => u.id === decoded.userId);
    if (!user) {
      console.log('User not found for ID:', decoded.userId);
      return res.status(401).json({ message: 'Invalid token' });
    }

    const { q } = req.query;
    console.log('Search query:', q);
    
    if (!q || q.length < 1) {
      console.log('Empty query, returning empty results');
      return res.json({ users: [] });
    }

    // Search users by name (case insensitive)
    const searchResults = users
      .filter(u => u.name.toLowerCase().includes(q.toLowerCase()))
      .map(({ password, ...user }) => user)
      .slice(0, 10); // Limit to 10 results

    console.log('Search results:', searchResults);
    res.json({ users: searchResults });
  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get all users (admin only)
router.get('/users', authenticateToken, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admin role required.' });
    }

    // Return all users without passwords
    const usersWithoutPasswords = users.map(({ password, ...user }) => user);
    res.json({ users: usersWithoutPasswords });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get all users with passwords (admin only) - for password management
router.get('/users/with-passwords', authenticateToken, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admin role required.' });
    }

    // Return all users with passwords (for admin password management)
    res.json({ users: users });
  } catch (error) {
    console.error('Get users with passwords error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Create new user (admin only)
router.post('/users', authenticateToken, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admin role required.' });
    }

    const { name, email, password, role = 'user', company = 'None' } = req.body;

    // Validate required fields
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email, and password are required' });
    }

    // Check if user already exists
    const existingUser = users.find(u => u.email === email);
    if (existingUser) {
      return res.status(400).json({ message: 'User with this email already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new user
    const newUser = {
      id: String(nextUserId++),
      name,
      email,
      password: hashedPassword,
      role,
      company,
      createdAt: new Date().toISOString()
    };

    users.push(newUser);
    saveUsers();

    // Return user without password
    const { password: _, ...userWithoutPassword } = newUser;
    res.status(201).json({ user: userWithoutPassword });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Update user (admin only)
router.put('/users/:id', authenticateToken, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admin role required.' });
    }

    const { id } = req.params;
    const { name, email, role, password, company } = req.body;

    const userIndex = users.findIndex(u => u.id === id);
    if (userIndex === -1) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Update user
    if (name) users[userIndex].name = name;
    if (email) users[userIndex].email = email;
    if (role) users[userIndex].role = role;
    if (company) users[userIndex].company = company;
    if (password) {
      // Hash new password
      users[userIndex].password = await bcrypt.hash(password, 10);
    }

    saveUsers();

    // Return updated user without password
    const { password: _, ...userWithoutPassword } = users[userIndex];
    res.json({ user: userWithoutPassword });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Delete user (admin only)
router.delete('/users/:id', authenticateToken, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admin role required.' });
    }

    const { id } = req.params;

    const userIndex = users.findIndex(u => u.id === id);
    if (userIndex === -1) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Don't allow deleting the current user
    if (users[userIndex].id === req.user.userId) {
      return res.status(400).json({ message: 'Cannot delete your own account' });
    }

    users.splice(userIndex, 1);
    saveUsers();

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// TEMPORARY VENDOR ROUTES (until server restart)
const vendorsFile = join(dataDir, 'vendors.json');

// Ensure vendors data file exists
const ensureVendorsFile = () => {
  try {
    if (!fs.existsSync(vendorsFile)) {
      const initialData = {
        moderators: [],
        sampleVendors: [],
        analytics: []
      };
      const dataDir = join(__dirname, '../data');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      fs.writeFileSync(vendorsFile, JSON.stringify(initialData, null, 2));
    }
  } catch (error) {
    console.error('Error ensuring vendors file:', error);
  }
};

// Load vendors data
const loadVendors = () => {
  ensureVendorsFile();
  try {
    const data = fs.readFileSync(vendorsFile, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading vendors:', error);
    return { moderators: [], sampleVendors: [], analytics: [] };
  }
};

// Save vendors data
const saveVendors = (vendors) => {
  try {
    fs.writeFileSync(vendorsFile, JSON.stringify(vendors, null, 2));
  } catch (error) {
    console.error('Error saving vendors:', error);
  }
};

// GET /api/auth/vendors - Get all vendors
router.get('/vendors', authenticateToken, (req, res) => {
  try {
    const vendors = loadVendors();
    res.json(vendors);
  } catch (error) {
    console.error('Error loading vendors:', error);
    res.status(500).json({ error: 'Failed to load vendors' });
  }
});

// POST /api/auth/vendors/moderators - Add new moderator
router.post('/vendors/moderators', authenticateToken, (req, res) => {
  try {
    const { name, email, phone, company, specialties, notes } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    const vendors = loadVendors();

    // Check if moderator already exists
    const existingModerator = vendors.moderators.find(mod => mod.email === email);
    if (existingModerator) {
      return res.status(400).json({ error: 'Moderator with this email already exists' });
    }

    const newModerator = {
      id: Date.now().toString(),
      name,
      email,
      phone: phone || '',
      company: company || '',
      specialties: specialties || [],
      notes: notes || '',
      pastProjects: [],
      createdAt: new Date().toISOString()
    };

    vendors.moderators.push(newModerator);
    saveVendors(vendors);

    res.status(201).json({ vendor: newModerator });
  } catch (error) {
    console.error('Error adding moderator:', error);
    res.status(500).json({ error: 'Failed to add moderator' });
  }
});

// POST /api/auth/vendors/sample-vendors - Add new sample vendor
router.post('/vendors/sample-vendors', authenticateToken, (req, res) => {
  try {
    const { name, email, phone, company, specialties, notes } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    const vendors = loadVendors();

    // Check if sample vendor already exists
    const existingVendor = vendors.sampleVendors.find(vendor => vendor.email === email);
    if (existingVendor) {
      return res.status(400).json({ error: 'Sample vendor with this email already exists' });
    }

    const newVendor = {
      id: Date.now().toString(),
      name,
      email,
      phone: phone || '',
      company: company || '',
      specialties: specialties || [],
      notes: notes || '',
      pastProjects: [],
      createdAt: new Date().toISOString()
    };

    vendors.sampleVendors.push(newVendor);
    saveVendors(vendors);

    res.status(201).json({ vendor: newVendor });
  } catch (error) {
    console.error('Error adding sample vendor:', error);
    res.status(500).json({ error: 'Failed to add sample vendor' });
  }
});

// POST /api/auth/vendors/analytics - Add new analytics vendor
router.post('/vendors/analytics', authenticateToken, (req, res) => {
  try {
    const { name, email, phone, company, specialties, notes } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    const vendors = loadVendors();

    // Check if analytics vendor already exists
    const existingVendor = vendors.analytics.find(vendor => vendor.email === email);
    if (existingVendor) {
      return res.status(400).json({ error: 'Analytics vendor with this email already exists' });
    }

    const newVendor = {
      id: Date.now().toString(),
      name,
      email,
      phone: phone || '',
      company: company || '',
      specialties: specialties || [],
      notes: notes || '',
      pastProjects: [],
      createdAt: new Date().toISOString()
    };

    vendors.analytics.push(newVendor);
    saveVendors(vendors);

    res.status(201).json({ vendor: newVendor });
  } catch (error) {
    console.error('Error adding analytics vendor:', error);
    res.status(500).json({ error: 'Failed to add analytics vendor' });
  }
});

export default router;
