import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticateToken } from '../middleware/auth.middleware.mjs';
import { requireCognitiveOrAdmin } from '../middleware/auth.middleware.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

const feedbackFile = path.join(__dirname, '../data/feedback.json');

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

// Create feedback (bug or feature)
router.post('/', authenticateToken, requireCognitiveOrAdmin, (req, res) => {
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
      statusUpdatedAt: new Date().toISOString()
    };

    if (type === 'bug') data.bugReports.unshift(item); else data.featureRequests.unshift(item);
    saveFeedback(data);
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
router.put('/:id', authenticateToken, (req, res) => {
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
    const updated = {
      ...existing,
      subject: subject ?? existing.subject,
      body: body ?? existing.body,
      priority: priority ?? existing.priority,
      status: status ?? existing.status,
      updatedAt: new Date().toISOString(),
      ...(status ? { statusUpdatedAt: new Date().toISOString() } : {})
    };
    list[itemIndex] = updated;
    data[collection] = list;
    saveFeedback(data);
    return res.json({ item: updated });
  } catch (e) {
    console.error('Update feedback error:', e);
    return res.status(500).json({ error: 'Failed to update feedback' });
  }
});

export default router;

