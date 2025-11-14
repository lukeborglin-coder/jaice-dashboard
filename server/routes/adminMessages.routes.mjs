import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticateToken, requireCognitiveOrAdmin } from '../middleware/auth.middleware.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const MESSAGES_PATH = path.join(DATA_DIR, 'adminMessages.json');

// Initialize messages file if it doesn't exist
async function initMessagesFile() {
  try {
    await fs.access(MESSAGES_PATH);
  } catch {
    await fs.writeFile(MESSAGES_PATH, JSON.stringify([], null, 2));
  }
}

// Public endpoints (accessible to all authenticated users) - must be defined BEFORE router.use()
// GET /api/admin-messages/active - Get active messages for users
router.get('/active', authenticateToken, async (req, res) => {
  try {
    await initMessagesFile();
    const data = await fs.readFile(MESSAGES_PATH, 'utf8');
    const messages = JSON.parse(data);
    const messagesArray = Array.isArray(messages) ? messages : [];
    
    // Only return active messages
    const activeMessages = messagesArray.filter(msg => msg.isActive);
    res.json({ messages: activeMessages });
  } catch (error) {
    console.error('Error loading active admin messages:', error);
    res.status(500).json({ error: 'Failed to load admin messages' });
  }
});

// GET /api/admin-messages/seen - Get list of message IDs the user has seen
router.get('/seen', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const seenMessagesPath = path.join(DATA_DIR, 'seenMessages.json');
    
    let seenMessages = {};
    try {
      const seenData = await fs.readFile(seenMessagesPath, 'utf8');
      seenMessages = JSON.parse(seenData);
    } catch {
      // File doesn't exist yet, that's fine
    }

    res.json({ seenMessageIds: seenMessages[userId] || [] });
  } catch (error) {
    console.error('Error loading seen messages:', error);
    res.status(500).json({ error: 'Failed to load seen messages' });
  }
});

// POST /api/admin-messages/:id/mark-seen - Mark a message as seen by a user
router.post('/:id/mark-seen', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    await initMessagesFile();
    const seenMessagesPath = path.join(DATA_DIR, 'seenMessages.json');
    
    let seenMessages = {};
    try {
      const seenData = await fs.readFile(seenMessagesPath, 'utf8');
      seenMessages = JSON.parse(seenData);
    } catch {
      // File doesn't exist yet, that's fine
    }

    if (!seenMessages[userId]) {
      seenMessages[userId] = [];
    }

    if (!seenMessages[userId].includes(id)) {
      seenMessages[userId].push(id);
      await fs.writeFile(seenMessagesPath, JSON.stringify(seenMessages, null, 2));
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error marking message as seen:', error);
    res.status(500).json({ error: 'Failed to mark message as seen' });
  }
});

// Enforce admin access for all routes below this line
router.use(authenticateToken, requireCognitiveOrAdmin);

// Admin-only endpoints (require Cognitive company or Admin role)
// GET /api/admin-messages - Get all admin messages
router.get('/', async (req, res) => {
  try {
    await initMessagesFile();
    const data = await fs.readFile(MESSAGES_PATH, 'utf8');
    const messages = JSON.parse(data);
    res.json({ messages: Array.isArray(messages) ? messages : [] });
  } catch (error) {
    console.error('Error loading admin messages:', error);
    res.status(500).json({ error: 'Failed to load admin messages' });
  }
});

// POST /api/admin-messages - Create a new admin message
router.post('/', async (req, res) => {
  try {
    await initMessagesFile();
    const { title, content, isActive } = req.body;

    if (!title || !content) {
      return res.status(400).json({ error: 'Title and content are required' });
    }

    const data = await fs.readFile(MESSAGES_PATH, 'utf8');
    const messages = JSON.parse(data);
    const messagesArray = Array.isArray(messages) ? messages : [];

    const newMessage = {
      id: `msg-${Date.now()}`,
      title,
      content,
      isActive: isActive !== undefined ? isActive : true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    messagesArray.push(newMessage);
    await fs.writeFile(MESSAGES_PATH, JSON.stringify(messagesArray, null, 2));

    res.json({ message: newMessage });
  } catch (error) {
    console.error('Error creating admin message:', error);
    res.status(500).json({ error: 'Failed to create admin message' });
  }
});

// PUT /api/admin-messages/:id - Update an admin message
router.put('/:id', async (req, res) => {
  try {
    await initMessagesFile();
    const { id } = req.params;
    const { title, content, isActive } = req.body;

    const data = await fs.readFile(MESSAGES_PATH, 'utf8');
    const messages = JSON.parse(data);
    const messagesArray = Array.isArray(messages) ? messages : [];

    const index = messagesArray.findIndex(msg => msg.id === id);
    if (index === -1) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (title !== undefined) messagesArray[index].title = title;
    if (content !== undefined) messagesArray[index].content = content;
    if (isActive !== undefined) messagesArray[index].isActive = isActive;
    messagesArray[index].updatedAt = new Date().toISOString();

    await fs.writeFile(MESSAGES_PATH, JSON.stringify(messagesArray, null, 2));

    res.json({ message: messagesArray[index] });
  } catch (error) {
    console.error('Error updating admin message:', error);
    res.status(500).json({ error: 'Failed to update admin message' });
  }
});

// DELETE /api/admin-messages/:id - Delete an admin message
router.delete('/:id', async (req, res) => {
  try {
    await initMessagesFile();
    const { id } = req.params;

    const data = await fs.readFile(MESSAGES_PATH, 'utf8');
    const messages = JSON.parse(data);
    const messagesArray = Array.isArray(messages) ? messages : [];

    const filtered = messagesArray.filter(msg => msg.id !== id);
    
    if (filtered.length === messagesArray.length) {
      return res.status(404).json({ error: 'Message not found' });
    }

    await fs.writeFile(MESSAGES_PATH, JSON.stringify(filtered, null, 2));

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting admin message:', error);
    res.status(500).json({ error: 'Failed to delete admin message' });
  }
});

export default router;


