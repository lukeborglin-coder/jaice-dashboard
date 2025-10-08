import express from 'express';
import multer from 'multer';
import fs from 'fs/promises';
import path from 'path';
import OpenAI from 'openai';

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), 'server', 'uploads', 'ae-training');
    // Ensure the directory exists
    fs.mkdir(uploadDir, { recursive: true }).then(() => {
      cb(null, uploadDir);
    }).catch(err => {
      cb(err, null);
    });
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    // Allow common document formats
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, Word, PowerPoint, and text files are allowed.'), false);
    }
  }
});

// Helper function to extract text from different file types
async function extractTextFromFile(filePath, mimetype) {
  try {
    if (mimetype === 'text/plain') {
      return await fs.readFile(filePath, 'utf8');
    } else if (mimetype === 'application/pdf') {
      // For PDF files, we'd need a PDF parser like pdf-parse
      // For now, return a placeholder
      return 'PDF content extraction not implemented yet';
    } else if (mimetype.includes('wordprocessingml') || mimetype.includes('msword')) {
      // For Word documents, we'd need a Word parser
      // For now, return a placeholder
      return 'Word document content extraction not implemented yet';
    } else if (mimetype.includes('presentationml') || mimetype.includes('powerpoint')) {
      // For PowerPoint files, we'd need a PPT parser
      // For now, return a placeholder
      return 'PowerPoint content extraction not implemented yet';
    }
    return '';
  } catch (error) {
    console.error('Error extracting text from file:', error);
    throw new Error('Failed to extract text from file');
  }
}

// Helper function to generate AE guidelines using AI
async function generateAEGuidelines(trainingMaterials, clientName, existingGuidelines = '') {
  const hasValidKey = process.env.OPENAI_API_KEY &&
                      process.env.OPENAI_API_KEY !== 'your_openai_api_key_here' &&
                      process.env.OPENAI_API_KEY.startsWith('sk-');

  if (!hasValidKey) {
    console.log('OpenAI API key not configured, skipping AE guidelines generation');
    return 'AI guidelines generation requires OpenAI API key configuration.';
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const systemPrompt = `You are an expert in pharmaceutical research and adverse event (AE) detection. You will receive training materials from a client and must create comprehensive guidelines for AI to detect potential adverse events in interview transcripts.

Your task:
1. Analyze the provided training materials
2. Extract key information about what constitutes an adverse event for this client
3. Create clear, actionable guidelines for AI to follow when scanning transcripts
4. Include specific terminology, symptoms, and reporting criteria
5. Provide examples of what should and shouldn't be flagged as AEs

Guidelines should be:
- Clear and specific
- Easy for AI to follow
- Focused on actionable criteria
- Include both positive and negative examples
- Cover terminology specific to the client's therapeutic area`;

    let userPrompt;
    
    if (existingGuidelines) {
      userPrompt = `Client: ${clientName}

EXISTING MASTER GUIDELINES:
${existingGuidelines}

NEW TRAINING MATERIALS:
${trainingMaterials.map((material, index) => `
Document ${index + 1}: ${material.filename}
Content:
${material.content}
`).join('\n---\n')}

Please review the new materials and update the master guidelines to incorporate any new information while preserving all existing guidelines. If the new materials don't add significant new information, keep the existing guidelines mostly unchanged but note that the materials were reviewed.`;
    } else {
      userPrompt = `Client: ${clientName}

Training Materials:
${trainingMaterials.map((material, index) => `
Document ${index + 1}: ${material.filename}
Content:
${material.content}
`).join('\n---\n')}

Please create comprehensive AE detection guidelines based on these materials.`;
    }

    const response = await client.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      max_tokens: 4000
    });

    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error('Error generating AE guidelines:', error);
    throw new Error('Failed to generate AE guidelines');
  }
}

// POST /api/ae-training/upload - Upload AE training materials for a client
router.post('/upload', upload.array('files', 10), async (req, res) => {
  try {
    const { clientId, clientName } = req.body;
    
    if (!clientId || !clientName) {
      return res.status(400).json({ error: 'Client ID and name are required' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    console.log(`Uploading ${req.files.length} files for client: ${clientName}`);

    // Extract text from all uploaded files
    const trainingMaterials = [];
    for (const file of req.files) {
      try {
        const content = await extractTextFromFile(file.path, file.mimetype);
        trainingMaterials.push({
          filename: file.originalname,
          content: content,
          uploadedAt: new Date().toISOString()
        });
      } catch (error) {
        console.error(`Error processing file ${file.originalname}:`, error);
        // Continue with other files even if one fails
      }
    }

    if (trainingMaterials.length === 0) {
      return res.status(400).json({ error: 'No files could be processed' });
    }

    // Get existing master guidelines file
    const masterGuidelinesPath = path.join(process.cwd(), 'server', 'uploads', 'ae-training', `${clientId}-master-guidelines.txt`);
    let existingGuidelines = '';
    
    try {
      existingGuidelines = await fs.readFile(masterGuidelinesPath, 'utf8');
    } catch (error) {
      // File doesn't exist yet, that's fine
      console.log('No existing master guidelines file found, creating new one');
    }

    // Generate updated AI guidelines
    const guidelines = await generateAEGuidelines(trainingMaterials, clientName, existingGuidelines);

    // Save the master guidelines file
    await fs.writeFile(masterGuidelinesPath, guidelines, 'utf8');

    // Store the training materials and guidelines
    const trainingData = {
      clientId,
      clientName,
      materials: trainingMaterials,
      guidelines,
      masterGuidelinesPath,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Save to file system (in a real app, this would go to a database)
    const dataDir = path.join(process.cwd(), 'server', 'data');
    await fs.mkdir(dataDir, { recursive: true });
    
    const filePath = path.join(dataDir, `ae-training-${clientId}.json`);
    await fs.writeFile(filePath, JSON.stringify(trainingData, null, 2));

    // Clean up uploaded files
    for (const file of req.files) {
      try {
        await fs.unlink(file.path);
      } catch (error) {
        console.error(`Error cleaning up file ${file.path}:`, error);
      }
    }

    res.json({
      success: true,
      message: 'Training materials uploaded and guidelines generated successfully',
      clientId,
      clientName,
      materialsCount: trainingMaterials.length,
      guidelines: guidelines.substring(0, 500) + '...' // Preview of guidelines
    });

  } catch (error) {
    console.error('Error uploading AE training materials:', error);
    res.status(500).json({ error: 'Failed to upload training materials: ' + error.message });
  }
});

// GET /api/ae-training/:clientId - Get AE training data for a client
router.get('/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;
    
    const dataDir = path.join(process.cwd(), 'server', 'data');
    const filePath = path.join(dataDir, `ae-training-${clientId}.json`);
    
    try {
      const data = await fs.readFile(filePath, 'utf8');
      const trainingData = JSON.parse(data);
      res.json(trainingData);
    } catch (error) {
      if (error.code === 'ENOENT') {
        res.status(404).json({ error: 'No training data found for this client' });
      } else {
        throw error;
      }
    }
  } catch (error) {
    console.error('Error retrieving AE training data:', error);
    res.status(500).json({ error: 'Failed to retrieve training data: ' + error.message });
  }
});

// POST /api/ae-training/check - Check transcript for AEs using client guidelines
router.post('/check', async (req, res) => {
  try {
    const { clientId, transcript, clientName } = req.body;
    
    if (!clientId || !transcript) {
      return res.status(400).json({ error: 'Client ID and transcript are required' });
    }

    // Get the training data for this client
    const dataDir = path.join(process.cwd(), 'server', 'data');
    const filePath = path.join(dataDir, `ae-training-${clientId}.json`);
    
    let trainingData;
    try {
      const data = await fs.readFile(filePath, 'utf8');
      trainingData = JSON.parse(data);
    } catch (error) {
      return res.status(404).json({ error: 'No training data found for this client. Please upload training materials first.' });
    }

    const hasValidKey = process.env.OPENAI_API_KEY &&
                        process.env.OPENAI_API_KEY !== 'your_openai_api_key_here' &&
                        process.env.OPENAI_API_KEY.startsWith('sk-');

    if (!hasValidKey) {
      return res.status(400).json({ error: 'OpenAI API key not configured for AE checking' });
    }

    try {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const systemPrompt = `You are an expert in pharmaceutical research and adverse event detection. You will analyze interview transcripts to identify potential adverse events (AEs) based on the provided guidelines.

Your task:
1. Carefully read the transcript
2. Identify any potential adverse events based on the guidelines
3. For each potential AE, provide:
   - Confidence level (High/Medium/Low)
   - Explanation of why it's an AE
   - Exact quote from the transcript
   - Severity assessment if possible

Be thorough but conservative - only flag clear potential AEs. When in doubt, err on the side of caution and flag it for human review.`;

      const userPrompt = `Client: ${clientName || 'Unknown Client'}

AE Detection Guidelines:
${trainingData.guidelines}

Transcript to analyze:
${transcript}

Please analyze this transcript for potential adverse events. Provide your findings in a structured format with confidence levels and exact quotes.`;

      const response = await client.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.2,
        max_tokens: 3000
      });

      const aeReport = response.choices[0].message.content.trim();

      res.json({
        success: true,
        clientId,
        clientName: clientName || trainingData.clientName,
        aeReport,
        analyzedAt: new Date().toISOString()
      });

    } catch (error) {
      console.error('Error checking for AEs:', error);
      res.status(500).json({ error: 'Failed to analyze transcript for AEs: ' + error.message });
    }

  } catch (error) {
    console.error('Error in AE checking:', error);
    res.status(500).json({ error: 'Failed to check for AEs: ' + error.message });
  }
});

// GET /api/ae-training/:clientId - Get AE training data for a client
router.get('/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;
    
    // Check if master guidelines file exists
    const masterGuidelinesPath = path.join(process.cwd(), 'server', 'uploads', 'ae-training', `${clientId}-master-guidelines.txt`);
    let masterGuidelines = '';
    let hasGuidelines = false;
    
    try {
      masterGuidelines = await fs.readFile(masterGuidelinesPath, 'utf8');
      hasGuidelines = true;
    } catch (error) {
      // File doesn't exist
      hasGuidelines = false;
    }
    
    // Get list of uploaded files
    const uploadDir = path.join(process.cwd(), 'server', 'uploads', 'ae-training');
    let uploadedFiles = [];
    
    try {
      const files = await fs.readdir(uploadDir);
      const filePromises = files
        .filter(file => file.startsWith(`${clientId}-`) && !file.includes('master-guidelines'))
        .map(async file => {
          const stats = await fs.stat(path.join(uploadDir, file));
          return {
            filename: file.replace(`${clientId}-`, ''),
            originalName: file.replace(`${clientId}-`, ''),
            uploadedAt: stats.mtime,
            size: stats.size
          };
        });
      
      uploadedFiles = await Promise.all(filePromises);
    } catch (error) {
      // Directory doesn't exist or no files
      uploadedFiles = [];
    }
    
    res.json({
      clientId,
      hasGuidelines,
      masterGuidelines,
      uploadedFiles
    });
    
  } catch (error) {
    console.error('Error getting AE training data:', error);
    res.status(500).json({ error: 'Failed to get AE training data' });
  }
});

export default router;
