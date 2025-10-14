# Questionnaire Parser Module

## Overview

The Questionnaire Parser is a new module in the JAICE platform that allows users to upload, edit, and export survey questionnaires. It provides a seamless interface for parsing .docx questionnaire files, editing questions, previewing surveys, and exporting to Forsta/Decipher-compatible XML format.

## Features

### 🔄 File Upload & Parsing
- Upload .docx questionnaire files
- Automatic parsing of questions with smart detection of:
  - Question numbers (S1, A1, A2, etc.)
  - Question types (single-select, multi-select, scale, open-end, grid)
  - Response options
  - Special tags ([SPECIFY], [ANCHOR], [RANDOMIZE])
- Intelligent fallback handling for malformed content

### ✏️ Questionnaire Editing
- **3-Tab Interface:**
  - **Questionnaire View (Edit Mode)**: Full editing capabilities
  - **Survey View (Preview)**: Forsta-style survey preview
  - **XML View (Export)**: Delphi-compatible XML generation

- **Question Management:**
  - Add/remove questions
  - Edit question text and response options
  - Change question types
  - Add/remove response options
  - Visual warning flags for questions needing review

### 🤖 AI Helper Features
- **Improve Wording**: AI-powered question text improvement
- **Suggest Options**: Automatic response option generation based on question content
- Smart suggestions for different question types

### 📊 Survey Preview
- Forsta-style survey rendering
- Visual representation of different question types
- Read-only preview mode

### 📤 XML Export
- Delphi/Forsta-compatible XML generation
- Copy to clipboard functionality
- Download XML files
- Well-formatted, readable code with proper indentation

## Technical Implementation

### Frontend Components
- `src/components/QuestionnaireParser.tsx` - Main component with 3-tab interface
- Integrated with existing JAICE styling and navigation
- Responsive design with sidebar for questionnaire management

### Backend Routes
- `server/routes/questionnaire.routes.mjs` - API endpoints for:
  - File upload and parsing
  - Questionnaire CRUD operations
  - XML generation
  - AI helper functions

### Key API Endpoints
- `POST /api/questionnaire/upload` - Upload and parse .docx files
- `GET /api/questionnaire/:projectId` - Get questionnaires for a project
- `PUT /api/questionnaire/:questionnaireId` - Update questionnaire
- `POST /api/questionnaire/xml` - Generate XML export
- `POST /api/questionnaire/improve-wording` - AI text improvement
- `POST /api/questionnaire/suggest-options` - AI option suggestions

## Usage

### 1. Access the Module
- Navigate to the "QNR" tab in the Tools section
- The module is integrated into the existing JAICE navigation

### 2. Upload a Questionnaire
- Click "Upload Questionnaire" button
- Select a .docx file containing your questionnaire
- The system will automatically parse and extract questions

### 3. Edit Questions
- Use the "Questionnaire View" tab to edit questions
- Modify question text, response options, and types
- Use AI helper buttons for automatic improvements
- Add new questions as needed

### 4. Preview Survey
- Switch to "Survey View" to see how the questionnaire will look
- Preview includes proper styling for different question types

### 5. Export XML
- Use "XML View" tab to generate Forsta-compatible XML
- Copy to clipboard or download the XML file
- XML includes proper formatting and metadata

## File Structure

```
src/components/
├── QuestionnaireParser.tsx          # Main component

server/routes/
├── questionnaire.routes.mjs          # Backend API routes

server/data/
├── questionnaires.json              # Stored questionnaire data
└── uploads/                        # Uploaded .docx files
```

## Integration with JAICE

The Questionnaire Parser seamlessly integrates with the existing JAICE platform:

- **Navigation**: Added to Tools dropdown as "QNR"
- **Styling**: Uses consistent JAICE brand colors and design patterns
- **Authentication**: Integrated with existing auth system
- **Data Storage**: Uses same data directory structure as other modules

## Supported Question Types

- **Single Select**: Radio button questions
- **Multi Select**: Checkbox questions  
- **Scale**: Rating scales (1-10)
- **Open End**: Text input questions
- **Grid**: Matrix-style questions
- **Other**: Custom question types

## AI Features

The module includes intelligent AI helpers:

- **Text Improvement**: Automatically improves question wording
- **Option Suggestions**: Generates appropriate response options based on question content
- **Smart Detection**: Automatically detects question types and special requirements

## Export Compatibility

Generated XML is compatible with:
- Forsta (formerly Decipher)
- Delphi survey platforms
- Standard survey research tools

## Error Handling

- Graceful handling of malformed .docx files
- Visual warnings for questions needing review
- Automatic fallback options for parsing issues
- Clear error messages and user guidance

## Future Enhancements

Potential future improvements:
- Advanced AI integration with OpenAI/Claude
- Skip logic and conditional questions
- Question validation and testing
- Integration with survey platforms
- Advanced XML customization options

## Dependencies

- **Frontend**: React, TypeScript, Tailwind CSS, Heroicons
- **Backend**: Express.js, Multer, Mammoth (for .docx parsing)
- **File Processing**: .docx text extraction and parsing
- **XML Generation**: Custom XML formatting for survey platforms

This module provides a complete solution for questionnaire management within the JAICE platform, from initial upload through final export for survey deployment.
