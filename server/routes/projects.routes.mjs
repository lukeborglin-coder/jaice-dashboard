import express from 'express';
import { authenticateToken, requireCognitiveOrAdmin } from '../middleware/auth.middleware.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Enforce authenticated + company access on all project routes
router.use(authenticateToken, requireCognitiveOrAdmin);

// Resolve data dir (supports persistent disk via DATA_DIR)
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const ensureDataDir = () => {
  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  } catch (e) {
    console.error('Failed to ensure data dir', e);
  }
};

// Helper function to read projects data
const readProjectsData = () => {
  try {
    ensureDataDir();
    const dataPath = path.join(dataDir, 'projects.json');
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
    ensureDataDir();
    const dataPath = path.join(dataDir, 'projects.json');
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

    console.log('🔍 [PUT] Received project update for:', projectId);
    console.log('🔍 [PUT] Team members received:', JSON.stringify(project.teamMembers, null, 2));

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
    console.log('🔍 [PUT] Project updated in memory, team members:', JSON.stringify(projectsData[userId][projectIndex].teamMembers, null, 2));

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

// PATCH /api/projects/:projectId - Partially update a project (for quick field updates like files)
router.patch('/:projectId', (req, res) => {
  try {
    const { projectId } = req.params;
    const updates = req.body; // Partial updates object

    // Get userId from auth token (JWT uses 'userId' field)
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log(`[PATCH] userId from token: ${userId}, projectId: ${projectId}`);

    const projectsData = readProjectsData();

    // Find which user owns this project (search across all users)
    let ownerUserId = null;
    let projectIndex = -1;

    for (const uid of Object.keys(projectsData)) {
      if (uid.includes('_archived')) continue; // Skip archived users
      const idx = projectsData[uid].findIndex(p => p.id === projectId);
      if (idx !== -1) {
        ownerUserId = uid;
        projectIndex = idx;
        break;
      }
    }

    if (!ownerUserId || projectIndex === -1) {
      console.log(`[PATCH] Project ${projectId} not found in any user's projects`);
      return res.status(404).json({ error: 'Project not found' });
    }

    console.log(`[PATCH] Found project ${projectId} owned by user ${ownerUserId}`);

    // Merge updates into existing project
    projectsData[ownerUserId][projectIndex] = {
      ...projectsData[ownerUserId][projectIndex],
      ...updates
    };

    // Save to file
    if (writeProjectsData(projectsData)) {
      res.json({
        message: 'Project updated successfully',
        project: projectsData[ownerUserId][projectIndex]
      });
    } else {
      res.status(500).json({ error: 'Failed to update project' });
    }
  } catch (error) {
    console.error('Error patching project:', error);
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

// Helper function to calculate task due dates based on project timeline
function calculateTaskDueDateFromTimeline(task, project) {
  const { dateNotes } = task;
  
  if (!dateNotes || dateNotes.trim() === '') {
    return null;
  }

  const normalizedNotes = dateNotes.toLowerCase().trim();

  // Handle ongoing tasks
  if (normalizedNotes === 'ongoing') {
    return null; // Ongoing tasks don't have a specific due date
  }

  try {
    // Extract timeline from project segments
    const segments = project.segments || [];
    console.log(`Project segments:`, JSON.stringify(segments, null, 2));
    const koSegment = segments.find(s => s.phase === 'Kickoff');
    const fieldworkStartSegment = segments.find(s => s.phase === 'Fielding');
    const fieldworkEndSegment = segments.find(s => s.phase === 'Fielding');
    const reportSegment = segments.find(s => s.phase === 'Reporting');
    
    console.log(`Found segments:`, {
      koSegment: koSegment ? { phase: koSegment.phase, startDate: koSegment.startDate, endDate: koSegment.endDate } : null,
      fieldworkStartSegment: fieldworkStartSegment ? { phase: fieldworkStartSegment.phase, startDate: fieldworkStartSegment.startDate, endDate: fieldworkStartSegment.endDate } : null,
      fieldworkEndSegment: fieldworkEndSegment ? { phase: fieldworkEndSegment.phase, startDate: fieldworkEndSegment.startDate, endDate: fieldworkEndSegment.endDate } : null,
      reportSegment: reportSegment ? { phase: reportSegment.phase, startDate: reportSegment.startDate, endDate: reportSegment.endDate } : null
    });

    // KO date patterns
    if (normalizedNotes.includes('ko date')) {
      const koDate = koSegment ? new Date(koSegment.startDate + 'T00:00:00') : null;
      if (koDate) {
        if (normalizedNotes.includes('1 day before')) {
          const businessDay = getPreviousBusinessDay(koDate);
          return formatDate(businessDay);
        }
        return formatDate(koDate);
      }
    }

    // Fieldwork start patterns
    if (normalizedNotes.includes('fieldwork start') || normalizedNotes.includes('first day of fieldwork')) {
      const fieldworkStart = fieldworkStartSegment ? new Date(fieldworkStartSegment.startDate + 'T00:00:00') : null;
      if (fieldworkStart) {
        if (normalizedNotes.includes('1 day before')) {
          const businessDay = getPreviousBusinessDay(fieldworkStart);
          return formatDate(businessDay);
        } else if (normalizedNotes.includes('first day of')) {
          return formatDate(fieldworkStart);
        }
      }
    }

    // Fieldwork end patterns
    if (normalizedNotes.includes('fieldwork ends') || normalizedNotes.includes('last day of field')) {
      const fieldworkEnd = fieldworkEndSegment ? new Date(fieldworkEndSegment.endDate + 'T00:00:00') : null;
      if (fieldworkEnd) {
        if (normalizedNotes.includes('1 day after')) {
          const businessDay = getNextBusinessDay(fieldworkEnd);
          return formatDate(businessDay);
        } else if (normalizedNotes.includes('last day of')) {
          return formatDate(fieldworkEnd);
        }
      }
    }

    // Pre-field patterns
    if (normalizedNotes.includes('pre-field')) {
      const fieldworkStart = fieldworkStartSegment ? new Date(fieldworkStartSegment.startDate + 'T00:00:00') : null;
      if (fieldworkStart) {
        if (normalizedNotes.includes('first day of')) {
          // Pre-field typically starts 1 week before fieldwork
          fieldworkStart.setUTCDate(fieldworkStart.getUTCDate() - 7);
          return formatDate(fieldworkStart);
        }
      }
    }

    // Week prior patterns
    if (normalizedNotes.includes('1 week prior to fieldwork start')) {
      const fieldworkStart = fieldworkStartSegment ? new Date(fieldworkStartSegment.startDate + 'T00:00:00') : null;
      if (fieldworkStart) {
        fieldworkStart.setUTCDate(fieldworkStart.getUTCDate() - 7);
        return formatDate(fieldworkStart);
      }
    }

    // First day of field patterns
    if (normalizedNotes.includes('first day of field')) {
      const fieldworkStart = fieldworkStartSegment ? new Date(fieldworkStartSegment.startDate + 'T00:00:00') : null;
      if (fieldworkStart) {
        if (normalizedNotes.includes('1 day before')) {
          const businessDay = getPreviousBusinessDay(fieldworkStart);
          return formatDate(businessDay);
        } else {
          return formatDate(fieldworkStart);
        }
      }
    }

    // Post-field patterns
    if (normalizedNotes.includes('post-field')) {
      const fieldworkEnd = fieldworkEndSegment ? new Date(fieldworkEndSegment.endDate + 'T00:00:00') : null;
      if (fieldworkEnd) {
        if (normalizedNotes.includes('first day of')) {
          // Post-field typically starts 1 day after fieldwork ends
          const businessDay = getNextBusinessDay(fieldworkEnd);
          return formatDate(businessDay);
        }
      }
    }

    // Report due date patterns
    if (normalizedNotes.includes('report due date')) {
      const reportDue = reportSegment ? new Date(reportSegment.endDate + 'T00:00:00') : null;
      if (reportDue) {
        if (normalizedNotes.includes('1 day before')) {
          const businessDay = getPreviousBusinessDay(reportDue);
          return formatDate(businessDay);
        } else if (normalizedNotes.includes('final')) {
          return formatDate(reportDue);
        }
      }
    }

    // If no pattern matches, return null
    console.warn(`No date pattern matched for: "${dateNotes}"`);
    return null;

  } catch (error) {
    console.error(`Error calculating date for task ${task.id} with dateNotes "${dateNotes}":`, error);
    return null;
  }
}

// Helper functions for date calculations
function formatDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getNextBusinessDay(date) {
  const nextDay = new Date(date);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  
  // If it's Saturday (6) or Sunday (0), move to Monday
  const dayOfWeek = nextDay.getUTCDay();
  if (dayOfWeek === 0) { // Sunday
    nextDay.setUTCDate(nextDay.getUTCDate() + 1); // Move to Monday
  } else if (dayOfWeek === 6) { // Saturday
    nextDay.setUTCDate(nextDay.getUTCDate() + 2); // Move to Monday
  }
  
  return nextDay;
}

function getPreviousBusinessDay(date) {
  const prevDay = new Date(date);
  prevDay.setUTCDate(prevDay.getUTCDate() - 1);
  
  // If it's Saturday (6) or Sunday (0), move to Friday
  const dayOfWeek = prevDay.getUTCDay();
  if (dayOfWeek === 0) { // Sunday
    prevDay.setUTCDate(prevDay.getUTCDate() - 2); // Move to Friday
  } else if (dayOfWeek === 6) { // Saturday
    prevDay.setUTCDate(prevDay.getUTCDate() - 1); // Move to Friday
  }
  
  return prevDay;
}

// Reset project tasks endpoint
router.post('/:projectId/reset-tasks', (req, res) => {
  console.log('🔄 Reset tasks endpoint hit!', req.params, req.body);
  try {
    const { userId } = req.body;
    const { projectId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const projectsData = readProjectsData();
    
    // Find the project in active projects
    let project = null;
    let projectIndex = -1;
    let userKey = null;

    if (projectsData[userId]) {
      projectIndex = projectsData[userId].findIndex(p => p.id === projectId);
      if (projectIndex !== -1) {
        project = projectsData[userId][projectIndex];
        userKey = userId;
      }
    }

    // If not found in active, check archived
    if (!project) {
      const archivedKey = `${userId}_archived`;
      if (projectsData[archivedKey]) {
        projectIndex = projectsData[archivedKey].findIndex(p => p.id === projectId);
        if (projectIndex !== -1) {
          project = projectsData[archivedKey][projectIndex];
          userKey = archivedKey;
        }
      }
    }

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Determine project type
    const isQualitativeProject = project.methodologyType === 'Qualitative' || 
      project.methodologyType === 'Qual' ||
      (project.name && project.name.toLowerCase().includes('qual'));

    console.log(`Resetting tasks for ${isQualitativeProject ? 'qualitative' : 'quantitative'} project:`, project.name);

    // Load task data from jaice_tasks.json
    const taskDataPath = path.join(__dirname, '..', '..', 'src', 'data', 'jaice_tasks.json');
    console.log('Looking for task data at:', taskDataPath);
    console.log('File exists:', fs.existsSync(taskDataPath));
    let taskData = [];
    
    try {
      if (fs.existsSync(taskDataPath)) {
        const taskDataContent = fs.readFileSync(taskDataPath, 'utf8');
        taskData = JSON.parse(taskDataContent);
        console.log('Loaded task data, count:', taskData.length);
      } else {
        console.error('Task data file not found at:', taskDataPath);
      }
    } catch (error) {
      console.error('Error loading task data:', error);
    }

    // Filter tasks based on project type
    const filteredTasks = taskData.filter(task => 
      isQualitativeProject ? task.quantQual === 'Qual' : task.quantQual === 'Quant'
    );

    // Create new tasks
    const newTasks = filteredTasks.map((task, index) => {
      // Calculate due date only if dateNotes is not empty
      let dueDate = null;
      if (task.dateNotes && task.dateNotes.trim() !== '') {
        // Use proper date calculation based on project timeline
        console.log(`Calculating date for task ${task.id}: "${task.dateNotes}"`);
        dueDate = calculateTaskDueDateFromTimeline(task, project);
        console.log(`Result: ${dueDate}`);
      }

      const isOngoing = task.dateNotes && task.dateNotes.toLowerCase().trim() === 'ongoing';
      if (isOngoing) {
        console.log(`Task ${task.id} marked as ongoing: "${task.task}"`);
      }

      return {
        id: task.id,
        description: task.task,
        phase: task.phase,
        status: 'pending',
        assignedTo: [],
        dueDate: dueDate,
        notes: task.notes || '',
        isOngoing: isOngoing,
        dateNotes: task.dateNotes || '',
      };
    });

    // Update the project with new tasks
    project.tasks = newTasks;
    projectsData[userKey][projectIndex] = project;

    if (writeProjectsData(projectsData)) {
      console.log(`Successfully reset ${newTasks.length} tasks for project: ${project.name}`);
      return res.json({ 
        message: 'Project tasks reset successfully',
        taskCount: newTasks.length,
        projectType: isQualitativeProject ? 'qualitative' : 'quantitative'
      });
    } else {
      return res.status(500).json({ error: 'Failed to save updated project' });
    }

  } catch (error) {
    console.error('Error resetting project tasks:', error);
    res.status(500).json({ error: 'Failed to reset project tasks' });
  }
});

export default router;
