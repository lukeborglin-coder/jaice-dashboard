import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticateToken } from '../middleware/auth.middleware.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const notificationsFile = path.join(DATA_DIR, 'notifications.json');

const ensureNotificationsFile = () => {
  const dir = path.dirname(notificationsFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(notificationsFile)) {
    fs.writeFileSync(notificationsFile, JSON.stringify({}, null, 2));
  }
};

const loadNotifications = () => {
  ensureNotificationsFile();
  const data = fs.readFileSync(notificationsFile, 'utf8');
  return JSON.parse(data || '{}');
};

const saveNotifications = (data) => {
  ensureNotificationsFile();
  fs.writeFileSync(notificationsFile, JSON.stringify(data, null, 2));
};

// Get notifications for a user
router.get('/', authenticateToken, (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'User ID not found' });
    }

    const data = loadNotifications();
    const userNotifications = data[userId] || [];
    
    // Sort by createdAt descending (newest first)
    const sorted = userNotifications.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return res.json({ notifications: sorted });
  } catch (e) {
    console.error('Get notifications error:', e);
    return res.status(500).json({ error: 'Failed to get notifications' });
  }
});

// Create a notification
router.post('/', authenticateToken, (req, res) => {
  try {
    const { userId, type, title, message, metadata } = req.body;
    
    if (!userId || !type || !title || !message) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const data = loadNotifications();
    if (!data[userId]) {
      data[userId] = [];
    }

    const notification = {
      id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      title,
      message,
      userId,
      createdAt: new Date().toISOString(),
      read: false,
      metadata: metadata || {}
    };

    data[userId].unshift(notification);
    
    // Keep only the latest 50 notifications per user
    if (data[userId].length > 50) {
      data[userId] = data[userId].slice(0, 50);
    }

    saveNotifications(data);
    return res.status(201).json({ notification });
  } catch (e) {
    console.error('Create notification error:', e);
    return res.status(500).json({ error: 'Failed to create notification' });
  }
});

// Mark notifications as read
router.put('/read', authenticateToken, (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    const { notificationIds } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'User ID not found' });
    }

    const data = loadNotifications();
    if (!data[userId]) {
      return res.json({ success: true });
    }

    if (notificationIds && Array.isArray(notificationIds)) {
      // Mark specific notifications as read
      data[userId] = data[userId].map(n => 
        notificationIds.includes(n.id) ? { ...n, read: true } : n
      );
    } else {
      // Mark all as read
      data[userId] = data[userId].map(n => ({ ...n, read: true }));
    }

    saveNotifications(data);
    return res.json({ success: true });
  } catch (e) {
    console.error('Mark notifications as read error:', e);
    return res.status(500).json({ error: 'Failed to mark notifications as read' });
  }
});

export default router;

