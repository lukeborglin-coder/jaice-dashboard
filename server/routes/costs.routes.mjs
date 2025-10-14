import express from 'express';
import { authenticateToken, requireCognitiveOrAdmin } from '../middleware/auth.middleware.mjs';
import {
  getProjectCosts,
  getAllProjectCosts,
  deleteProjectCosts
} from '../services/costTracking.service.mjs';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();

// Get data directory
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const PROJECTS_PATH = path.join(DATA_DIR, 'projects.json');

// Helper to read projects data
async function readProjectsData() {
  try {
    const data = await fs.readFile(PROJECTS_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading projects data:', error);
    return {};
  }
}

// GET /api/costs - Get all project costs (admin only)
router.get('/', authenticateToken, requireCognitiveOrAdmin, async (req, res) => {
  try {
    const costSummaries = await getAllProjectCosts();
    const projectsData = await readProjectsData();

    // Enrich cost data with project information
    const enrichedSummaries = costSummaries.map(summary => {
      // Find the project across all users
      let projectInfo = null;
      for (const userProjects of Object.values(projectsData)) {
        if (Array.isArray(userProjects)) {
          const project = userProjects.find(p => p.id === summary.projectId);
          if (project) {
            projectInfo = {
              name: project.name,
              archived: project.archived || false,
              createdAt: project.createdAt
            };
            break;
          }
        }
      }

      return {
        ...summary,
        projectName: projectInfo?.name || 'Unknown Project',
        archived: projectInfo?.archived || false,
        createdAt: projectInfo?.createdAt || null
      };
    });

    res.json({ costs: enrichedSummaries });
  } catch (error) {
    console.error('Error fetching all costs:', error);
    res.status(500).json({ error: 'Failed to fetch costs' });
  }
});

// GET /api/costs/:projectId - Get costs for a specific project
router.get('/:projectId', authenticateToken, async (req, res) => {
  try {
    const { projectId } = req.params;
    const costs = await getProjectCosts(projectId);
    res.json(costs);
  } catch (error) {
    console.error('Error fetching project costs:', error);
    res.status(500).json({ error: 'Failed to fetch project costs' });
  }
});

// DELETE /api/costs/:projectId - Delete costs for a project (admin only)
router.delete('/:projectId', authenticateToken, requireCognitiveOrAdmin, async (req, res) => {
  try {
    const { projectId } = req.params;
    const success = await deleteProjectCosts(projectId);

    if (success) {
      res.json({ message: 'Project costs deleted successfully' });
    } else {
      res.status(500).json({ error: 'Failed to delete project costs' });
    }
  } catch (error) {
    console.error('Error deleting project costs:', error);
    res.status(500).json({ error: 'Failed to delete project costs' });
  }
});

export default router;
