# Data Storage Guide

This document explains where all data is stored in your JAICE Dashboard application.

## Base Data Directory

All data is stored in a central directory that can be configured via environment variables:

- **Development**: `server/data/` (relative to server directory)
- **Production (Render)**: `/server/data` (persistent disk mount)

The base directory is determined by:
```javascript
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
```

## Storage Structure by Feature

### 📁 Main Data Directory: `data/`

```
data/
├── projects.json              # All user projects
├── users.json                 # User accounts and authentication
├── vendors.json               # Moderators, sample vendors, analytics vendors
├── costs.json                 # Cost tracking data
├── feedback.json              # User feedback
├── questionnaires.json        # Questionnaire metadata
├── transcripts.json           # Transcript metadata
├── savedAnalyses.json         # Content Analysis (CA-X) saved analyses
├── storytelling.json          # Storytelling data
├── tabulations.json           # Data tabulation metadata
├── conjoint-workflows.json    # Conjoint analysis workflows
├── uploads/                   # All uploaded files (transcripts, data files, etc.)
├── questionnaire-data/        # Questionnaire-specific data files
│   └── {questionnaireId}/
│       ├── metadata.json      # Column mappings, file info
│       ├── data_{timestamp}.xlsx  # Uploaded data files
│       └── processed-data.json    # Processed/analyzed data
├── discussion-guides/         # Discussion guide files
│   ├── {projectId}.html       # HTML formatted guides
│   └── {projectId}.docx       # Original DOCX files
├── data-tabulations/          # Data tabulation files
└── transcripts/               # Transcript-specific directories
    └── {projectId}/
```

---

## Detailed Storage Locations by Tab/Feature

### 1. **Questionnaires Tab** (`questionnaire.routes.mjs`)

**Metadata:**
- `data/questionnaires.json` - All questionnaire definitions organized by projectId

**Files:**
- `data/uploads/` - Original uploaded .docx questionnaire files
  - Files named: `questionnaire_{timestamp}.docx`

**Questionnaire-Specific Data:**
- `data/questionnaire-data/{questionnaireId}/`
  - `metadata.json` - Column mappings, file upload info, processing metadata
  - `data_{timestamp}.xlsx` - Uploaded Excel/CSV data files
  - `processed-data.json` - Processed data with statistics

**Key Routes:**
- `POST /api/questionnaire/upload` - Saves to `questionnaires.json` and `uploads/`
- `POST /api/questionnaire/upload-data-file` - Saves to `questionnaire-data/{id}/`
- `POST /api/questionnaire/upload-data` - Processes and saves to `processed-data.json`

---

### 2. **Transcripts Tab** (`transcripts.routes.mjs`)

**Metadata:**
- `data/transcripts.json` - All transcript metadata organized by projectId
  - Structure: `{ projectId: [transcript1, transcript2, ...] }`

**Files:**
- `data/uploads/` - Original and cleaned transcript files
  - Original files: Named by upload timestamp
  - Cleaned files: `cleaned_{projectName}_R{respno}_{timestamp}.docx`

**Key Routes:**
- `POST /api/transcripts/upload` - Saves metadata to `transcripts.json` and file to `uploads/`
- `POST /api/transcripts/clean` - Creates cleaned version in `uploads/`
- `GET /api/transcripts/download/:projectId/:transcriptId` - Downloads from `uploads/`

---

### 3. **Content Analysis (CA-X) Tab** (`contentAnalysisX.routes.mjs`)

**Metadata:**
- `data/savedAnalyses.json` - All saved content analyses
  - Contains: analysis data, guide maps, quotes, project associations

**Files:**
- `data/discussion-guides/`
  - `{projectId}.html` - Formatted discussion guide HTML
  - `{projectId}.docx` - Original discussion guide DOCX
- `data/uploads/` - Temporary uploads during analysis creation

**Excel Exports:**
- Generated Excel files are saved temporarily and served via API
- Not permanently stored (regenerated on demand)

**Key Routes:**
- `POST /api/caX/save` - Saves to `savedAnalyses.json` and discussion guide files
- `GET /api/caX/load/:analysisId` - Loads from `savedAnalyses.json`
- `POST /api/caX/generate-from-transcripts` - Uses transcripts from `transcripts.json`

---

### 4. **Storytelling Tab** (`storytelling.routes.mjs`)

**Metadata:**
- `data/storytelling.json` - All storytelling data
  - Structure: `{ "{projectId}-{analysisId}": { strategicQuestions, reportData, ... } }`
  - Uses composite key: `projectId-analysisId` for multiple analyses per project

**Key Routes:**
- `POST /api/storytelling/save` - Saves to `storytelling.json`
- `GET /api/storytelling/:projectId/:analysisId` - Loads from `storytelling.json`

---

### 5. **Data Tabulation Tab** (`dataTabulation.routes.mjs`)

**Metadata:**
- `data/tabulations.json` - Tabulation metadata and configurations

**Files:**
- `data/data-tabulations/` - Tabulation-specific files
  - Generated tables and analysis files

**Key Routes:**
- `POST /api/data-tabulation/save` - Saves to `tabulations.json`
- `GET /api/data-tabulation/load/:id` - Loads from `tabulations.json`

---

### 6. **Conjoint Tab** (`conjoint.routes.mjs`)

**Metadata:**
- `data/conjoint-workflows.json` - Conjoint analysis workflows and designs

**Key Routes:**
- `POST /api/conjoint/workflows` - Saves to `conjoint-workflows.json`
- `GET /api/conjoint/workflows` - Loads from `conjoint-workflows.json`

---

### 7. **Projects** (`projects.routes.mjs`)

**Metadata:**
- `data/projects.json` - All user projects
  - Structure: `{ userId: [project1, project2, ...] }`

**Key Routes:**
- `GET /api/projects` - Loads from `projects.json`
- `POST /api/projects` - Saves to `projects.json`
- `PUT /api/projects/:id` - Updates in `projects.json`

---

### 8. **Vendors** (`vendors.routes.mjs`)

**Metadata:**
- `data/vendors.json` - Vendor information
  - Structure: `{ moderators: [], sampleVendors: [], analytics: [] }`

**Key Routes:**
- `GET /api/vendors` - Loads from `vendors.json`
- `POST /api/vendors/{type}` - Saves to `vendors.json`

---

### 9. **Cost Tracking** (`costs.routes.mjs`)

**Metadata:**
- `data/costs.json` - Cost tracking data organized by projectId

**Key Routes:**
- `GET /api/costs/:projectId` - Loads from `costs.json`
- Cost data is automatically logged by various services

---

### 10. **Other Data Files**

- `data/users.json` - User authentication and account data
- `data/feedback.json` - User feedback submissions
- `data/ae-training-{clientId}.json` - AE training data (per client)

---

## File Upload Storage

All file uploads go through multer and are stored in:

**Base Upload Directory:**
- `process.env.FILES_DIR || path.join(DATA_DIR, 'uploads')`
- Default: `data/uploads/`

**File Types Stored:**
- Transcripts (.docx)
- Questionnaire files (.docx)
- Data files (.xlsx, .xls, .csv)
- Discussion guides (.docx)
- Other uploaded documents

**File Naming:**
- Most files use timestamp-based naming: `{type}_{timestamp}.{ext}`
- Some files use project-specific naming: `{projectId}.{ext}`

---

## Environment Variables

### Development
```bash
# Optional - defaults to server/data
DATA_DIR=./server/data
FILES_DIR=./server/data/uploads
```

### Production (Render)
```bash
DATA_DIR=/server/data          # Points to persistent disk
FILES_DIR=/server/data/uploads # Uploads on persistent disk
```

---

## Data Persistence

### Local Development
- All data is stored in `server/data/` directory
- This directory should be in `.gitignore` (not committed to git)
- Data persists between server restarts

### Production (Render)
- Data is stored on a persistent disk mounted at `/server/data`
- This disk survives deployments and server restarts
- **Important**: Ensure `DATA_DIR` environment variable is set correctly

---

## Important Notes

1. **JSON Files**: Most metadata is stored in JSON files. These are read/written atomically (entire file is read, modified, then written back).

2. **File Organization**: 
   - Project-specific data is often organized by `projectId`
   - Questionnaire-specific data uses `questionnaireId`
   - Some features use composite keys like `{projectId}-{analysisId}`

3. **File Paths**: 
   - Some routes store relative paths in JSON
   - Some routes store absolute paths
   - Always check the specific route implementation

4. **Backup**: 
   - The entire `data/` directory should be backed up regularly
   - In production, the persistent disk at `/server/data` is your backup

5. **Storage Growth**: 
   - Transcript files can be large (multiple MB each)
   - Data files (Excel/CSV) can also be large
   - Monitor disk usage, especially in production

---

## Finding Your Data

### Local Development
```bash
# Navigate to data directory
cd server/data

# List all JSON files (metadata)
ls *.json

# List all uploaded files
ls uploads/

# List questionnaire-specific data
ls questionnaire-data/
```

### Production (Render)
- Access via Render dashboard → Service → Shell
- Or check logs for file paths
- Data is at `/server/data` on the persistent disk

---

## Troubleshooting

### Data Not Persisting
1. Check `DATA_DIR` environment variable is set correctly
2. Verify directory exists and is writable
3. Check file permissions
4. Review server logs for file system errors

### Files Not Found
1. Check if file path in JSON is relative or absolute
2. Verify file exists in `uploads/` directory
3. Check if file was moved or renamed
4. Review upload route logs

### Storage Full
1. Check disk usage: `du -sh /server/data` (production)
2. Clean up old temporary files
3. Archive old projects/analyses
4. Consider increasing disk size (Render)

---

## Summary Table

| Feature | Metadata File | File Storage | Notes |
|---------|--------------|--------------|-------|
| Questionnaires | `questionnaires.json` | `uploads/`, `questionnaire-data/{id}/` | Includes parsed questions and data files |
| Transcripts | `transcripts.json` | `uploads/` | Original and cleaned versions |
| Content Analysis | `savedAnalyses.json` | `discussion-guides/` | Analysis data and guide files |
| Storytelling | `storytelling.json` | - | Strategic questions and report data |
| Data Tabulation | `tabulations.json` | `data-tabulations/` | Tabulation configs and results |
| Conjoint | `conjoint-workflows.json` | - | Workflow definitions |
| Projects | `projects.json` | - | Project metadata |
| Vendors | `vendors.json` | - | Vendor contacts and info |
| Costs | `costs.json` | - | Cost tracking per project |
| Users | `users.json` | - | Authentication data |

---

*Last updated: Based on codebase analysis of all route files*











