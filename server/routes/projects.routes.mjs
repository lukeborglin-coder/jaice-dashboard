import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Helper function to read projects data
const readProjectsData = () => {
  try {
    const dataPath = path.join(__dirname, '..', 'data', 'projects.json');
    if (fs.existsSync(dataPath)) {
      const data = fs.readFileSync(dataPath, 'utf8');
      return JSON.parse(data);
    }
    return {};
  } catch (error) {
    console.error('Error reading projects data:', error);
    return {};
  }
};

// Helper function to write projects data
const writeProjectsData = (data) => {
  try {
    const dataPath = path.join(__dirname, '..', 'data', 'projects.json');
    const dataDir = path.dirname(dataPath);
    
    // Ensure data directory exists
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error('Error writing projects data:', error);
    return false;
  }
};

// GET /api/projects - Get all projects for a user
router.get('/', (req, res) => {
  try {
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    
    const projectsData = readProjectsData();
    const userProjects = projectsData[userId] || [];
    
    
    res.json({ projects: userProjects });
  } catch (error) {
    console.error('Error fetching projects:', error);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

// POST /api/projects - Create a new project
router.post('/', (req, res) => {
  try {
    const { userId, project } = req.body;
    
    if (!userId || !project) {
      return res.status(400).json({ error: 'User ID and project data are required' });
    }
    
    const projectsData = readProjectsData();
    
    // Initialize user's projects array if it doesn't exist
    if (!projectsData[userId]) {
      projectsData[userId] = [];
    }
    
    // Add the new project
    projectsData[userId].push(project);
    
    // Save to file
    if (writeProjectsData(projectsData)) {
      res.status(201).json({ 
        message: 'Project created successfully',
        project: project
      });
    } else {
      res.status(500).json({ error: 'Failed to save project' });
    }
  } catch (error) {
    console.error('Error creating project:', error);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// PUT /api/projects/:projectId - Update a project
router.put('/:projectId', (req, res) => {
  try {
    const { userId, project } = req.body;
    const { projectId } = req.params;
    
    if (!userId || !project) {
      return res.status(400).json({ error: 'User ID and project data are required' });
    }
    
    
    const projectsData = readProjectsData();
    
    if (!projectsData[userId]) {
      return res.status(404).json({ error: 'User projects not found' });
    }
    
    // Find and update the project
    const projectIndex = projectsData[userId].findIndex(p => p.id === projectId);
    
    if (projectIndex === -1) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    projectsData[userId][projectIndex] = project;
    
    // Save to file
    if (writeProjectsData(projectsData)) {
      res.json({ 
        message: 'Project updated successfully',
        project: project
      });
    } else {
      res.status(500).json({ error: 'Failed to update project' });
    }
  } catch (error) {
    console.error('Error updating project:', error);
    res.status(500).json({ error: 'Failed to update project' });
  }
});

// POST /api/projects/:projectId/archive - Archive a project
router.post('/:projectId/archive', (req, res) => {
  try {
    const { userId } = req.body;
    const { projectId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const projectsData = readProjectsData();

    if (!projectsData[userId]) {
      return res.status(404).json({ error: 'User projects not found' });
    }

    // Find the project to archive
    const projectIndex = projectsData[userId].findIndex(p => p.id === projectId);

    if (projectIndex === -1) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Get the project and mark it as archived
    const project = projectsData[userId][projectIndex];
    project.archived = true;
    project.archivedDate = new Date().toISOString();

    // Initialize archived projects array if it doesn't exist
    const archivedKey = `${userId}_archived`;
    if (!projectsData[archivedKey]) {
      projectsData[archivedKey] = [];
    }

    // Move project to archived
    projectsData[archivedKey].push(project);
    projectsData[userId].splice(projectIndex, 1);

    // Save to file
    if (writeProjectsData(projectsData)) {
      res.json({ message: 'Project archived successfully' });
    } else {
      res.status(500).json({ error: 'Failed to archive project' });
    }
  } catch (error) {
    console.error('Error archiving project:', error);
    res.status(500).json({ error: 'Failed to archive project' });
  }
});

// GET /api/projects/archived - Get archived projects for a user
router.get('/archived', (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const projectsData = readProjectsData();
    const archivedKey = `${userId}_archived`;
    const archivedProjects = projectsData[archivedKey] || [];

    res.json({ projects: archivedProjects });
  } catch (error) {
    console.error('Error fetching archived projects:', error);
    res.status(500).json({ error: 'Failed to fetch archived projects' });
  }
});

// GET /api/projects/all - Get all projects across all users (for admin/overview)
router.get('/all', (req, res) => {
  try {
    const projectsData = readProjectsData();
    const allProjects = [];
    
    // Collect all projects from all users
    Object.keys(projectsData).forEach(userId => {
      if (!userId.endsWith('_archived')) {
        const userProjects = projectsData[userId] || [];
        // Include all projects - treat projects without 'archived' field as active
        allProjects.push(...userProjects);
      }
    });
    
    res.json({ projects: allProjects });
  } catch (error) {
    console.error('Error fetching all projects:', error);
    res.status(500).json({ error: 'Failed to fetch all projects' });
  }
});

// POST /api/projects/:projectId/unarchive - Unarchive a project
router.post('/:projectId/unarchive', (req, res) => {
  try {
    const { userId } = req.body;
    const { projectId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const projectsData = readProjectsData();
    const archivedKey = `${userId}_archived`;

    if (!projectsData[archivedKey]) {
      return res.status(404).json({ error: 'Archived projects not found' });
    }

    // Find the project to unarchive
    const projectIndex = projectsData[archivedKey].findIndex(p => p.id === projectId);

    if (projectIndex === -1) {
      return res.status(404).json({ error: 'Archived project not found' });
    }

    // Get the project and remove archived status
    const project = projectsData[archivedKey][projectIndex];
    project.archived = false;
    delete project.archivedDate;

    // Initialize active projects array if it doesn't exist
    if (!projectsData[userId]) {
      projectsData[userId] = [];
    }

    // Move project back to active
    projectsData[userId].push(project);
    projectsData[archivedKey].splice(projectIndex, 1);

    // Save to file
    if (writeProjectsData(projectsData)) {
      res.json({ message: 'Project unarchived successfully', project: project });
    } else {
      res.status(500).json({ error: 'Failed to unarchive project' });
    }
  } catch (error) {
    console.error('Error unarchiving project:', error);
    res.status(500).json({ error: 'Failed to unarchive project' });
  }
});

// DELETE /api/projects/:projectId - Delete a project (from active or archived)
router.delete('/:projectId', (req, res) => {
  try {
    const { userId } = req.body;
    const { projectId } = req.params;

    console.log('DELETE DEBUG - Received:', { projectId, userId, userIdType: typeof userId });

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const projectsData = readProjectsData();
    console.log('DELETE DEBUG - Available project data keys:', Object.keys(projectsData));
    console.log('DELETE DEBUG - Looking for userId key:', userId, 'Exists:', !!projectsData[userId]);

    // First check active projects
    if (projectsData[userId]) {
      const activeProjectIndex = projectsData[userId].findIndex(p => p.id === projectId);
      if (activeProjectIndex !== -1) {
        projectsData[userId].splice(activeProjectIndex, 1);

        if (writeProjectsData(projectsData)) {
          return res.json({ message: 'Project deleted successfully' });
        } else {
          return res.status(500).json({ error: 'Failed to delete project' });
        }
      }
    }

    // Check archived projects
    const archivedKey = `${userId}_archived`;
    if (projectsData[archivedKey]) {
      const archivedProjectIndex = projectsData[archivedKey].findIndex(p => p.id === projectId);
      if (archivedProjectIndex !== -1) {
        projectsData[archivedKey].splice(archivedProjectIndex, 1);

        if (writeProjectsData(projectsData)) {
          return res.json({ message: 'Project deleted successfully' });
        } else {
          return res.status(500).json({ error: 'Failed to delete project' });
        }
      }
    }

    // Project not found in either active or archived
    return res.status(404).json({ error: 'Project not found' });

  } catch (error) {
    console.error('Error deleting project:', error);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

export default router;

