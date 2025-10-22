import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import contentAnalysisRouter from './routes/contentAnalysis.routes.mjs';
import contentAnalysisXRouter from './routes/contentAnalysisX.routes.mjs';
import transcriptsRouter from './routes/transcripts.routes.mjs';
import authRouter from './routes/auth.routes.mjs';
import projectsRouter from './routes/projects.routes.mjs';
import vendorsRouter from './routes/vendors.routes.mjs';
import feedbackRouter from './routes/feedback.routes.mjs';
import aeTrainingRouter from './routes/aeTraining.routes.mjs';
import costsRouter from './routes/costs.routes.mjs';
import storytellingRouter from './routes/storytelling.routes.mjs';
import migrateTranscriptsRouter from './routes/migrate-transcripts.mjs';
import questionnaireRouter from './routes/questionnaire.routes.mjs';
import openEndCodingRouter from './routes/openEndCoding.routes.mjs';

// Load environment variables
const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 3005;

// Trust proxy - required for rate limiting behind Render proxy
app.set('trust proxy', 1);

// Middleware
// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // unsafe-inline needed for Vite in dev
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "http://localhost:*", "https://jaice-dashboard-backend.onrender.com", "https://jaice-dashboard.onrender.com"]
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  frameguard: { action: 'deny' },
  noSniff: true,
  xssFilter: true
}));

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

// Rate limiting
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Increased limit for development (was 5)
  message: 'Too many authentication attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for authenticated admin operations and token verification
    const path = req.path;
    const isAdminRoute = path.startsWith('/users') || path.startsWith('/vendors');
    const isVerifyRoute = path === '/verify'; // Skip rate limiting for token verification
    return isAdminRoute || isVerifyRoute;
  }
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each IP to 1000 requests per windowMs for general API (increased for development)
  message: 'Too many requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  // Skip rate limiting if there's an error (prevents crashes)
  skipFailedRequests: true,
  skipSuccessfulRequests: false
});

// Routes
app.use('/api/auth', authLimiter, authRouter);
app.use('/api/projects', apiLimiter, projectsRouter);
app.use('/api/vendors', apiLimiter, vendorsRouter);
app.use('/api/ca', apiLimiter, contentAnalysisRouter);
app.use('/api/caX', apiLimiter, contentAnalysisXRouter);
app.use('/api/transcripts', apiLimiter, transcriptsRouter);
app.use('/api/feedback', apiLimiter, feedbackRouter);
app.use('/api/ae-training', apiLimiter, aeTrainingRouter);
app.use('/api/costs', apiLimiter, costsRouter);
app.use('/api/storytelling', apiLimiter, storytellingRouter);
app.use('/api/migrate', apiLimiter, migrateTranscriptsRouter);
app.use('/api/questionnaire', apiLimiter, questionnaireRouter);
app.use('/api/openend', apiLimiter, openEndCodingRouter);

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

