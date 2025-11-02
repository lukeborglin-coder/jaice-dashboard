# Data Tabulation Creator - Implementation Plan

## Overview
This document outlines the plan for building a Data Tabulation Creator that can parse survey data files and create frequency tables, nets, and other tabulations.

## Data File Format Understanding

### Sheet 1 (Data Sheet - typically named "A1" or similar)
- **Format**: Standard survey response data
- **Structure**: 
  - Row 1: Variable names (headers)
  - Rows 2+: Response data where values are numeric codes
  - Each column represents a survey variable (e.g., QS1, QS2, Region, etc.)

### Sheet 2 (Datamap Sheet)
- **Format**: Variable definitions and code labels
- **Structure**:
  - Variable definition: `[variableName]: Description text`
  - Type line: `Values: 1-N` or `Open numeric/text response`
  - Code definitions: `["", "codeValue", "codeLabel"]`
    - Column 0: Empty string
    - Column 1: Code value (e.g., "1", "2", "3")
    - Column 2: Code label (e.g., "Terminated", "Qualified", "Partial")

## Core Features

### 1. File Upload & Parsing
- Upload Excel (.xlsx) files
- Parse both data and datamap sheets
- Validate file structure
- Display parsing status and errors

### 2. Variable Management
- List all variables with descriptions
- Show variable types (categorical with codes vs. open-ended)
- Display code labels for categorical variables
- Filter/search variables
- Variable metadata (type, code count, etc.)

### 3. Frequency Tables
- Select variable(s) to tabulate
- Generate frequency counts
- Show percentages (base, column, row)
- Display code labels instead of codes
- Support for:
  - Single variable frequency tables
  - Cross-tabulations (2+ variables)
  - Multiple response variables (check all that apply)

### 4. Nets/Banners
- Combine multiple codes into nets
- Create custom groupings
- Support for:
  - Top box nets (combining top 2, top 3, etc.)
  - Bottom box nets
  - Custom code combinations
  - Multi-variable nets

### 5. Export & Output
- Export to Excel with formatted tables
- Export to CSV
- Copy to clipboard
- Print-friendly format
- Include base sizes and percentages

## Technical Architecture

### Frontend Components
1. **DataTabulation.tsx** - Main component
   - File upload interface
   - Variable selector
   - Tabulation builder
   - Results display

2. **DataParser Service** (utils or services folder)
   - Parse Excel files using xlsx library
   - Extract data and datamap sheets
   - Build variable metadata structure
   - Map codes to labels

3. **TabulationEngine** (utils)
   - Generate frequency tables
   - Calculate percentages
   - Build nets
   - Cross-tabulation logic

### Backend (if needed)
- File upload endpoint (if file processing needed server-side)
- Store/retrieve parsed data (optional)
- Export generation service (optional)

## Data Structure

```typescript
interface VariableDefinition {
  name: string;
  description: string;
  type: 'categorical' | 'open-numeric' | 'open-text';
  codes: Record<string, string>; // {code: label}
}

interface ParsedDataFile {
  variables: VariableDefinition[];
  data: Record<string, any>[]; // Array of response objects
  rowCount: number;
  metadata: {
    fileName: string;
    uploadedAt: Date;
    sheetNames: string[];
  };
}

interface FrequencyTable {
  variable: string;
  base: number;
  rows: Array<{
    code: string;
    label: string;
    count: number;
    percentage: number;
  }>;
}

interface NetDefinition {
  name: string;
  variable: string;
  codes: string[]; // Codes to combine
}
```

## Implementation Steps

1. **Phase 1: Parser & Basic UI**
   - Create Excel parser utility
   - Build file upload component
   - Display parsed variables

2. **Phase 2: Frequency Tables**
   - Single variable frequency tables
   - Code label mapping
   - Percentage calculations

3. **Phase 3: Advanced Features**
   - Cross-tabulations
   - Nets functionality
   - Export capabilities

4. **Phase 4: Integration**
   - Add to App.tsx navigation
   - Add to quantitativeTools array
   - Test end-to-end workflow

## UI/UX Considerations

- Follow existing JAICE Dashboard design patterns
- Use Tailwind CSS styling
- Use Heroicons for icons
- Responsive design
- Loading states for file processing
- Error handling and user feedback
- Drag-and-drop file upload
- Table styling consistent with other components

## Example Workflow

1. User navigates to "Data Tabulation" tab
2. User uploads Excel file (data + datamap format)
3. System parses file and displays variables list
4. User selects variable(s) to tabulate
5. System generates frequency table with code labels
6. User can create nets by selecting codes to combine
7. User exports results to Excel/CSV

