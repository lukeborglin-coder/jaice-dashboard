import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import contentAnalysisRouter from './routes/contentAnalysis.routes.mjs';
import contentAnalysisXRouter from './routes/contentAnalysisX.routes.mjs';
import authRouter from './routes/auth.routes.mjs';
import projectsRouter from './routes/projects.routes.mjs';
import vendorsRouter from './routes/vendors.routes.mjs';
import feedbackRouter from './routes/feedback.routes.mjs';

// Load environment variables
config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3005;

// Middleware
const allowedOrigins = process.env.CORS_ORIGIN
  ? [process.env.CORS_ORIGIN, /^http:\/\/localhost:\d+$/]
  : [/^http:\/\/localhost:\d+$/];

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));
// Increase body size limit to handle large transcripts (10MB)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static files (for serving uploaded files)
const FILES_DIR = process.env.FILES_DIR || path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'uploads');
app.use('/uploads', express.static(FILES_DIR));

// Routes
app.use('/api/auth', authRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/vendors', vendorsRouter);
app.use('/api/ca', contentAnalysisRouter);
app.use('/api/caX', contentAnalysisXRouter);
app.use('/api/feedback', feedbackRouter);

// Health check
app.get('/health', (req, res) => {
  const hasValidKey = process.env.OPENAI_API_KEY &&
                      process.env.OPENAI_API_KEY !== 'your_openai_api_key_here' &&
                      process.env.OPENAI_API_KEY.startsWith('sk-');

  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    openaiConfigured: hasValidKey
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 JAICE Dashboard Server running on http://localhost:${PORT}`);
  console.log(`📊 Content Analysis API available at http://localhost:${PORT}/api/ca`);

  const hasValidKey = process.env.OPENAI_API_KEY &&
                      process.env.OPENAI_API_KEY !== 'your_openai_api_key_here' &&
                      process.env.OPENAI_API_KEY.startsWith('sk-');

  if (!hasValidKey) {
    console.log('⚠️  Warning: OPENAI_API_KEY not set. AI generation will not work.');
    console.log('   Edit server/.env file with: OPENAI_API_KEY=sk-your-actual-key-here');
  } else {
    console.log('✅ OpenAI API key configured - AI generation enabled');
  }

  console.log(`🔗 Frontend should connect to: http://localhost:${PORT}`);
});

export default app;

