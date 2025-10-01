import express from 'express';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticateToken, requireCognitiveOrAdmin } from '../middleware/auth.middleware.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();

// Enforce authenticated + company access on all vendor routes
router.use(authenticateToken, requireCognitiveOrAdmin);

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const VENDORS_FILE = path.join(DATA_DIR, 'vendors.json');

// Ensure vendors data file exists
async function ensureVendorsFile() {
  try {
    // Ensure data dir exists
    if (!fsSync.existsSync(DATA_DIR)) fsSync.mkdirSync(DATA_DIR, { recursive: true });
    await fs.access(VENDORS_FILE);
  } catch (error) {
    // File doesn't exist, create it with initial structure
    const initialData = {
      moderators: [],
      sampleVendors: [],
      analytics: []
    };
    await fs.mkdir(path.dirname(VENDORS_FILE), { recursive: true });
    await fs.writeFile(VENDORS_FILE, JSON.stringify(initialData, null, 2));
  }
}

// Load vendors data
async function loadVendors() {
  await ensureVendorsFile();
  const data = await fs.readFile(VENDORS_FILE, 'utf8');
  return JSON.parse(data);
}

// Save vendors data
async function saveVendors(vendors) {
  await fs.writeFile(VENDORS_FILE, JSON.stringify(vendors, null, 2));
}

// GET /api/vendors - Get all vendors
router.get('/', authenticateToken, async (req, res) => {
  try {
    const vendors = await loadVendors();
    res.json(vendors);
  } catch (error) {
    console.error('Error loading vendors:', error);
    res.status(500).json({ error: 'Failed to load vendors' });
  }
});

// GET /api/vendors/moderators - Get all moderators
router.get('/moderators', authenticateToken, async (req, res) => {
  try {
    const vendors = await loadVendors();
    res.json({ moderators: vendors.moderators || [] });
  } catch (error) {
    console.error('Error loading moderators:', error);
    res.status(500).json({ error: 'Failed to load moderators' });
  }
});

// POST /api/vendors/moderators - Add new moderator
router.post('/moderators', authenticateToken, async (req, res) => {
  try {
    const { name, email, phone, company, specialties, notes } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    const vendors = await loadVendors();

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
    await saveVendors(vendors);

    res.status(201).json({ moderator: newModerator });
  } catch (error) {
    console.error('Error adding moderator:', error);
    res.status(500).json({ error: 'Failed to add moderator' });
  }
});

// PUT /api/vendors/moderators/:id - Update moderator
router.put('/moderators/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, phone, company, specialties, notes, customSchedule } = req.body;

    const vendors = await loadVendors();
    const moderatorIndex = vendors.moderators.findIndex(mod => mod.id === id);

    if (moderatorIndex === -1) {
      return res.status(404).json({ error: 'Moderator not found' });
    }

    vendors.moderators[moderatorIndex] = {
      ...vendors.moderators[moderatorIndex],
      name: name || vendors.moderators[moderatorIndex].name,
      email: email || vendors.moderators[moderatorIndex].email,
      phone: phone || vendors.moderators[moderatorIndex].phone,
      company: company || vendors.moderators[moderatorIndex].company,
      specialties: specialties || vendors.moderators[moderatorIndex].specialties,
      notes: notes || vendors.moderators[moderatorIndex].notes,
      // optionally persist custom schedule entries
      ...(customSchedule ? { customSchedule } : {}),
      updatedAt: new Date().toISOString()
    };

    await saveVendors(vendors);
    res.json({ moderator: vendors.moderators[moderatorIndex] });
  } catch (error) {
    console.error('Error updating moderator:', error);
    res.status(500).json({ error: 'Failed to update moderator' });
  }
});

// DELETE /api/vendors/moderators/:id - Delete moderator
router.delete('/moderators/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const vendors = await loadVendors();

    const moderatorIndex = vendors.moderators.findIndex(mod => mod.id === id);
    if (moderatorIndex === -1) {
      return res.status(404).json({ error: 'Moderator not found' });
    }

    vendors.moderators.splice(moderatorIndex, 1);
    await saveVendors(vendors);

    res.json({ message: 'Moderator deleted successfully' });
  } catch (error) {
    console.error('Error deleting moderator:', error);
    res.status(500).json({ error: 'Failed to delete moderator' });
  }
});

// SAMPLE VENDORS ROUTES

// GET /api/vendors/sample-vendors - Get all sample vendors
router.get('/sample-vendors', authenticateToken, async (req, res) => {
  try {
    const vendors = await loadVendors();
    res.json({ sampleVendors: vendors.sampleVendors || [] });
  } catch (error) {
    console.error('Error loading sample vendors:', error);
    res.status(500).json({ error: 'Failed to load sample vendors' });
  }
});

// POST /api/vendors/sample-vendors - Add new sample vendor
router.post('/sample-vendors', authenticateToken, async (req, res) => {
  try {
    const { name, email, phone, company, specialties, notes } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    const vendors = await loadVendors();

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
    await saveVendors(vendors);

    res.status(201).json({ vendor: newVendor });
  } catch (error) {
    console.error('Error adding sample vendor:', error);
    res.status(500).json({ error: 'Failed to add sample vendor' });
  }
});

// PUT /api/vendors/sample-vendors/:id - Update sample vendor
router.put('/sample-vendors/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, phone, company, specialties, notes, customSchedule } = req.body;

    const vendors = await loadVendors();
    const idx = vendors.sampleVendors.findIndex(v => v.id === id);

    if (idx === -1) {
      return res.status(404).json({ error: 'Sample vendor not found' });
    }

    vendors.sampleVendors[idx] = {
      ...vendors.sampleVendors[idx],
      name: name || vendors.sampleVendors[idx].name,
      email: email || vendors.sampleVendors[idx].email,
      phone: phone || vendors.sampleVendors[idx].phone,
      company: company || vendors.sampleVendors[idx].company,
      specialties: specialties || vendors.sampleVendors[idx].specialties,
      notes: notes || vendors.sampleVendors[idx].notes,
      ...(customSchedule ? { customSchedule } : {}),
      updatedAt: new Date().toISOString()
    };

    await saveVendors(vendors);
    res.json({ vendor: vendors.sampleVendors[idx] });
  } catch (error) {
    console.error('Error updating sample vendor:', error);
    res.status(500).json({ error: 'Failed to update sample vendor' });
  }
});

// DELETE /api/vendors/sample-vendors/:id - Delete sample vendor
router.delete('/sample-vendors/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const vendors = await loadVendors();
    const idx = vendors.sampleVendors.findIndex(v => v.id === id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Sample vendor not found' });
    }
    vendors.sampleVendors.splice(idx, 1);
    await saveVendors(vendors);
    res.json({ message: 'Sample vendor deleted successfully' });
  } catch (error) {
    console.error('Error deleting sample vendor:', error);
    res.status(500).json({ error: 'Failed to delete sample vendor' });
  }
});

// ANALYTICS ROUTES

// GET /api/vendors/analytics - Get all analytics vendors
router.get('/analytics', authenticateToken, async (req, res) => {
  try {
    const vendors = await loadVendors();
    res.json({ analytics: vendors.analytics || [] });
  } catch (error) {
    console.error('Error loading analytics vendors:', error);
    res.status(500).json({ error: 'Failed to load analytics vendors' });
  }
});

// POST /api/vendors/analytics - Add new analytics vendor
router.post('/analytics', authenticateToken, async (req, res) => {
  try {
    const { name, email, phone, company, specialties, notes } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    const vendors = await loadVendors();

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
    await saveVendors(vendors);

    res.status(201).json({ vendor: newVendor });
  } catch (error) {
    console.error('Error adding analytics vendor:', error);
    res.status(500).json({ error: 'Failed to add analytics vendor' });
  }
});

// PUT /api/vendors/analytics/:id - Update analytics vendor
router.put('/analytics/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, phone, company, specialties, notes, customSchedule } = req.body;

    const vendors = await loadVendors();
    const idx = vendors.analytics.findIndex(v => v.id === id);

    if (idx === -1) {
      return res.status(404).json({ error: 'Analytics vendor not found' });
    }

    vendors.analytics[idx] = {
      ...vendors.analytics[idx],
      name: name || vendors.analytics[idx].name,
      email: email || vendors.analytics[idx].email,
      phone: phone || vendors.analytics[idx].phone,
      company: company || vendors.analytics[idx].company,
      specialties: specialties || vendors.analytics[idx].specialties,
      notes: notes || vendors.analytics[idx].notes,
      ...(customSchedule ? { customSchedule } : {}),
      updatedAt: new Date().toISOString()
    };

    await saveVendors(vendors);
    res.json({ vendor: vendors.analytics[idx] });
  } catch (error) {
    console.error('Error updating analytics vendor:', error);
    res.status(500).json({ error: 'Failed to update analytics vendor' });
  }
});

// DELETE /api/vendors/analytics/:id - Delete analytics vendor
router.delete('/analytics/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const vendors = await loadVendors();
    const idx = vendors.analytics.findIndex(v => v.id === id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Analytics vendor not found' });
    }
    vendors.analytics.splice(idx, 1);
    await saveVendors(vendors);
    res.json({ message: 'Analytics vendor deleted successfully' });
  } catch (error) {
    console.error('Error deleting analytics vendor:', error);
    res.status(500).json({ error: 'Failed to delete analytics vendor' });
  }
});

export default router;
