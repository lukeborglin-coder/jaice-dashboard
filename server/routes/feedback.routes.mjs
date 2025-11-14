import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticateToken } from '../middleware/auth.middleware.mjs';
import { requireCognitiveOrAdmin } from '../middleware/auth.middleware.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const feedbackFile = path.join(DATA_DIR, 'feedback.json');
const usersFile = path.join(DATA_DIR, 'users.json');

const ensureFeedbackFile = () => {
  const dir = path.dirname(feedbackFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(feedbackFile)) {
    fs.writeFileSync(feedbackFile, JSON.stringify({ bugReports: [], featureRequests: [] }, null, 2));
  }
};

const loadFeedback = () => {
  ensureFeedbackFile();
  const data = fs.readFileSync(feedbackFile, 'utf8');
  return JSON.parse(data || '{"bugReports":[],"featureRequests":[]}');
};

const saveFeedback = (data) => {
  ensureFeedbackFile();
  fs.writeFileSync(feedbackFile, JSON.stringify(data, null, 2));
};

// Helper function to get all admin users
const getAdminUsers = () => {
  try {
    if (!fs.existsSync(usersFile)) {
      return [];
    }
    const usersData = JSON.parse(fs.readFileSync(usersFile, 'utf8') || '[]');
    return Array.isArray(usersData) ? usersData.filter(u => u.role === 'admin') : [];
  } catch (error) {
    console.error('Error loading admin users:', error);
    return [];
  }
};

// Helper function to create a notification
const createNotification = async (userId, type, title, message, metadata = {}) => {
  try {
    const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3005';
    const token = process.env.INTERNAL_API_TOKEN || 'internal-token'; // You may want to use a service token
    
    // For now, we'll create the notification directly in the notifications file
    // since we're in the same server process
    const notificationsFile = path.join(DATA_DIR, 'notifications.json');
    const ensureNotificationsFile = () => {
      const dir = path.dirname(notificationsFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (!fs.existsSync(notificationsFile)) {
        fs.writeFileSync(notificationsFile, JSON.stringify({}, null, 2));
      }
    };

    ensureNotificationsFile();
    const notificationsData = JSON.parse(fs.readFileSync(notificationsFile, 'utf8') || '{}');
    
    if (!notificationsData[userId]) {
      notificationsData[userId] = [];
    }

    const notification = {
      id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      title,
      message,
      userId,
      createdAt: new Date().toISOString(),
      read: false,
      metadata
    };

    notificationsData[userId].unshift(notification);
    
    // Keep only the latest 50 notifications per user
    if (notificationsData[userId].length > 50) {
      notificationsData[userId] = notificationsData[userId].slice(0, 50);
    }

    fs.writeFileSync(notificationsFile, JSON.stringify(notificationsData, null, 2));
  } catch (error) {
    console.error('Error creating notification:', error);
  }
};

// Create feedback (bug or feature)
router.post('/', authenticateToken, requireCognitiveOrAdmin, async (req, res) => {
  try {
    const { type, subject, body, priority } = req.body;
    if (!type || !subject || !body || !priority) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!['bug', 'feature'].includes(type)) {
      return res.status(400).json({ error: 'Invalid type' });
    }
    if (!['low', 'medium', 'high'].includes(priority)) {
      return res.status(400).json({ error: 'Invalid priority' });
    }

    const data = loadFeedback();
    const item = {
      id: String(Date.now()),
      type,
      subject,
      body,
      priority,
      status: 'pending review',
      createdBy: req.user?.userId || req.user?.id || 'unknown',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      statusUpdatedAt: new Date().toISOString(),
      comments: []
    };

    if (type === 'bug') data.bugReports.unshift(item); else data.featureRequests.unshift(item);
    saveFeedback(data);

    // Send notifications to all admins
    const adminUsers = getAdminUsers();
    const submitterName = req.user?.name || req.user?.email || 'A user';
    const reportType = type === 'bug' ? 'bug report' : 'feature request';
    
    for (const admin of adminUsers) {
      await createNotification(
        admin.id,
        type === 'bug' ? 'feedback_submitted_bug' : 'feedback_submitted_feature',
        `New ${reportType.charAt(0).toUpperCase() + reportType.slice(1)} Submitted`,
        `${submitterName} submitted a new ${reportType}: "${subject}"`,
        {
          feedbackId: item.id,
          feedbackType: type,
          subject: subject,
          priority: priority,
          createdBy: item.createdBy
        }
      );
    }

    return res.status(201).json({ item });
  } catch (e) {
    console.error('Create feedback error:', e);
    return res.status(500).json({ error: 'Failed to create feedback' });
  }
});

// List feedback (optionally filter by type/status)
router.get('/', authenticateToken, requireCognitiveOrAdmin, (req, res) => {
  try {
    const { type, status } = req.query;
    const data = loadFeedback();
    let bugReports = data.bugReports;
    let featureRequests = data.featureRequests;
    if (status) {
      bugReports = bugReports.filter(i => i.status === status);
      featureRequests = featureRequests.filter(i => i.status === status);
    }
    if (type === 'bug') return res.json({ bugReports });
    if (type === 'feature') return res.json({ featureRequests });
    return res.json({ bugReports, featureRequests });
  } catch (e) {
    console.error('List feedback error:', e);
    return res.status(500).json({ error: 'Failed to list feedback' });
  }
});

// Update feedback (admin only)
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    // Only admins can change status
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin role required' });
    }

    const { id } = req.params;
    const { status, priority, subject, body } = req.body;

    const validStatuses = ['pending review', 'working on it', 'done', 'archived'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    if (priority && !['low', 'medium', 'high'].includes(priority)) {
      return res.status(400).json({ error: 'Invalid priority' });
    }

    const data = loadFeedback();
    const all = [...data.bugReports, ...data.featureRequests];
    const idx = all.findIndex(i => i.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });

    let collection = data.bugReports.find(i => i.id === id) ? 'bugReports' : 'featureRequests';
    const list = data[collection];
    const itemIndex = list.findIndex(i => i.id === id);
    if (itemIndex === -1) return res.status(404).json({ error: 'Not found' });

    const existing = list[itemIndex];
    const oldStatus = existing.status;
    const updated = {
      ...existing,
      subject: subject ?? existing.subject,
      body: body ?? existing.body,
      priority: priority ?? existing.priority,
      status: status ?? existing.status,
      updatedAt: new Date().toISOString(),
      ...(status ? { statusUpdatedAt: new Date().toISOString() } : {}),
      comments: existing.comments || []
    };
    list[itemIndex] = updated;
    data[collection] = list;
    saveFeedback(data);

    // Send notification if status changed and it's not the submitter
    if (status && status !== oldStatus && existing.createdBy) {
      const adminName = req.user?.name || req.user?.email || 'Admin';
      const reportType = existing.type === 'bug' ? 'bug report' : 'feature request';
      await createNotification(
        existing.createdBy,
        'feedback_status_changed',
        `${reportType.charAt(0).toUpperCase() + reportType.slice(1)} Status Updated`,
        `Your ${reportType} "${existing.subject}" status has been changed to "${status}" by ${adminName}`,
        {
          feedbackId: existing.id,
          feedbackType: existing.type,
          oldStatus,
          newStatus: status,
          subject: existing.subject
        }
      );
    }

    return res.json({ item: updated });
  } catch (e) {
    console.error('Update feedback error:', e);
    return res.status(500).json({ error: 'Failed to update feedback' });
  }
});

// Add comment to feedback (admin only)
router.post('/:id/comments', authenticateToken, (req, res) => {
  try {
    // Only admins can add comments
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin role required' });
    }

    const { id } = req.params;
    const { comment } = req.body;

    if (!comment || !comment.trim()) {
      return res.status(400).json({ error: 'Comment is required' });
    }

    const data = loadFeedback();
    const all = [...data.bugReports, ...data.featureRequests];
    const item = all.find(i => i.id === id);
    
    if (!item) {
      return res.status(404).json({ error: 'Not found' });
    }

    let collection = data.bugReports.find(i => i.id === id) ? 'bugReports' : 'featureRequests';
    const list = data[collection];
    const itemIndex = list.findIndex(i => i.id === id);
    
    if (itemIndex === -1) {
      return res.status(404).json({ error: 'Not found' });
    }

    const existing = list[itemIndex];
    if (!existing.comments) {
      existing.comments = [];
    }

    const newComment = {
      id: `comment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      text: comment.trim(),
      createdBy: req.user?.userId || req.user?.id || 'unknown',
      createdByName: req.user?.name || req.user?.email || 'Admin',
      createdAt: new Date().toISOString()
    };

    existing.comments.push(newComment);
    existing.updatedAt = new Date().toISOString();
    list[itemIndex] = existing;
    data[collection] = list;
    saveFeedback(data);

    // Send notification to the submitter if they exist and it's not the admin commenting on their own report
    if (existing.createdBy && existing.createdBy !== (req.user?.userId || req.user?.id)) {
      const adminName = req.user?.name || req.user?.email || 'Admin';
      const reportType = existing.type === 'bug' ? 'bug report' : 'feature request';
      createNotification(
        existing.createdBy,
        'feedback_comment',
        `New Comment on Your ${reportType.charAt(0).toUpperCase() + reportType.slice(1)}`,
        `${adminName} commented on your ${reportType}: "${existing.subject}"`,
        {
          feedbackId: existing.id,
          feedbackType: existing.type,
          subject: existing.subject,
          commentId: newComment.id,
          commentText: newComment.text.substring(0, 100) // First 100 chars for preview
        }
      );
    }

    return res.json({ comment: newComment, item: existing });
  } catch (e) {
    console.error('Add comment error:', e);
    return res.status(500).json({ error: 'Failed to add comment' });
  }
});

export default router;
