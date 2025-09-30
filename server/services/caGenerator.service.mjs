import fs from 'fs/promises';
import path from 'path';
import OpenAI from 'openai';
import xlsx from 'xlsx';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function generateCAFromDG(dgPath, outDir) {
  try {
    // Check and initialize OpenAI client at runtime
    const hasValidKey = process.env.OPENAI_API_KEY &&
                        process.env.OPENAI_API_KEY !== 'your_openai_api_key_here' &&
                        process.env.OPENAI_API_KEY.startsWith('sk-');

    console.log('OpenAI API Key check:', {
      exists: !!process.env.OPENAI_API_KEY,
      length: process.env.OPENAI_API_KEY?.length || 0,
      startsWithSk: process.env.OPENAI_API_KEY?.startsWith('sk-') || false,
      hasValidKey
    });

    if (!hasValidKey) {
      throw new Error('OpenAI API key not configured. Please set OPENAI_API_KEY in environment variables.');
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // 1) For now, extract basic text from docx file (simplified approach)
    const dgText = await extractTextFromDocx(dgPath);

    // 2) Call OpenAI with structured prompt to emit JSON by sheet
    const promptPath = path.join(__dirname, '../prompts/ca_from_dg_prompt.txt');
    const prompt = await fs.readFile(promptPath, 'utf-8');

    const sys = `You are a senior market-research analyst who converts Discussion Guides into structured Content Analysis tables for Excel. 

CRITICAL: Extract the EXACT section headings from the discussion guide and use them as sheet names. Do not modify, abbreviate, or standardize the section names. Preserve original capitalization, spacing, and punctuation exactly as written in the document.

Look for section headings that are typically formatted as:
- Bold text
- Numbered sections (1., 2., etc.)
- All caps headings
- Underlined text
- Text followed by colons

Output STRICT JSON exactly matching the provided schema. No prose.`;

    const enhancedPrompt = prompt + `

=== DISCUSSION GUIDE TEXT ===
${dgText}

=== INSTRUCTIONS ===
1. Carefully identify ALL section headings in the discussion guide
2. Use the EXACT section names as sheet names (preserve formatting)
3. Create a "Demographics" sheet with only: Respondent ID, Specialty, Date, Time (ET)
4. For each section, create appropriate columns based on the questions/topics in that section
5. Include 3-5 empty template rows for data entry
6. EXCLUDE any "Introduction" sections - these are moderator introductions where respondents don't speak, so they should be ignored
7. For any final sections meant to thank and conclude the session (e.g., "Thank and Conclude", "Closing", "Wrap-Up"), consolidate these into a single "Misc." sheet with columns: Respondent ID, Final Comments, Additional Notes`;

    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.1,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: enhancedPrompt }
      ],
      response_format: { type: "json_object" }
    });

    const json = JSON.parse(resp.choices[0].message.content);

    // Filter out "Introduction" section if it exists
    if (json.INTRODUCTION) delete json.INTRODUCTION;
    if (json.Introduction) delete json.Introduction;
    if (json.introduction) delete json.introduction;

    // 3) Build workbook from dynamic JSON sections
    const wb = xlsx.utils.book_new();
    for (const [sectionName, rows] of Object.entries(json)) {
      if (Array.isArray(rows) && rows.length > 0) {
        // Get column headers from the first row
        const cols = Object.keys(rows[0]);
        const ws = xlsx.utils.json_to_sheet(rows, { header: cols });
        xlsx.utils.book_append_sheet(wb, ws, sectionName);
      }
    }

    const outPath = path.join(outDir, `CA_${Date.now()}.xlsx`);
    xlsx.writeFile(wb, outPath);
    return outPath;
  } catch (error) {
    console.error('Error in generateCAFromDG:', error);
    throw error;
  }
}

// NEW: Generate JSON preview instead of Excel file
export async function generateCAFromDGAsJSON(dgPath) {
  try {
    // Check and initialize OpenAI client at runtime
    const hasValidKey = process.env.OPENAI_API_KEY &&
                        process.env.OPENAI_API_KEY !== 'your_openai_api_key_here' &&
                        process.env.OPENAI_API_KEY.startsWith('sk-');

    if (!hasValidKey) {
      throw new Error('OpenAI API key not configured. Please set OPENAI_API_KEY in environment variables.');
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // 1) Extract text from docx file
    const dgText = await extractTextFromDocx(dgPath);

    // 2) Call OpenAI with structured prompt to emit JSON by sheet
    const promptPath = path.join(__dirname, '../prompts/ca_from_dg_prompt.txt');
    const prompt = await fs.readFile(promptPath, 'utf-8');

    const sys = `You are a senior market-research analyst who converts Discussion Guides into structured Content Analysis tables for Excel. 

CRITICAL: Extract the EXACT section headings from the discussion guide and use them as sheet names. Do not modify, abbreviate, or standardize the section names. Preserve original capitalization, spacing, and punctuation exactly as written in the document.

Look for section headings that are typically formatted as:
- Bold text
- Numbered sections (1., 2., etc.)
- All caps headings
- Underlined text
- Text followed by colons

Output STRICT JSON exactly matching the provided schema. No prose.`;

    const enhancedPrompt = prompt + `

=== DISCUSSION GUIDE TEXT ===
${dgText}

=== INSTRUCTIONS ===
1. Carefully identify ALL section headings in the discussion guide
2. Use the EXACT section names as sheet names (preserve formatting)
3. Create a "Demographics" sheet with only: Respondent ID, Specialty, Date, Time (ET)
4. For each section, create appropriate columns based on the questions/topics in that section
5. Include 3-5 empty template rows for data entry
6. EXCLUDE any "Introduction" sections - these are moderator introductions where respondents don't speak, so they should be ignored
7. For any final sections meant to thank and conclude the session (e.g., "Thank and Conclude", "Closing", "Wrap-Up"), consolidate these into a single "Misc." sheet with columns: Respondent ID, Final Comments, Additional Notes`;

    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.1,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: enhancedPrompt }
      ],
      response_format: { type: "json_object" }
    });

    const json = JSON.parse(resp.choices[0].message.content);

    // Filter out "Introduction" section if it exists
    if (json.INTRODUCTION) delete json.INTRODUCTION;
    if (json.Introduction) delete json.Introduction;
    if (json.introduction) delete json.introduction;

    // Return the dynamic JSON structure as-is, since AI creates the appropriate format
    return json;
  } catch (error) {
    console.error('Error in generateCAFromDGAsJSON:', error);
    throw error;
  }
}

// NEW: Generate Excel from dynamic JSON data
export async function generateExcelFromJSON(jsonData) {
  try {
    const wb = xlsx.utils.book_new();

    // Handle dynamic sections
    for (const [sectionName, rows] of Object.entries(jsonData)) {
      if (Array.isArray(rows) && rows.length > 0) {
        // Get column headers from the first row
        const cols = Object.keys(rows[0]);
        const ws = xlsx.utils.json_to_sheet(rows, { header: cols });
        xlsx.utils.book_append_sheet(wb, ws, sectionName);
      }
    }

    // Return buffer instead of writing to file
    return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
  } catch (error) {
    console.error('Error in generateExcelFromJSON:', error);
    throw error;
  }
}

// Enhanced text extraction from docx using mammoth
async function extractTextFromDocx(filePath) {
  try {
    // Try to use mammoth for better docx parsing
    try {
      const mammoth = await import('mammoth');
      const buffer = await fs.readFile(filePath);
      const result = await mammoth.extractRawText({ buffer });
      console.log('Successfully extracted text using mammoth');
      return result.value;
    } catch (importError) {
      // Fallback: simplified extraction
      console.log('Using fallback text extraction');
      const buffer = await fs.readFile(filePath);
      // This is a very basic fallback - in production you'd want better docx parsing
      return `Discussion Guide content extracted from file: ${path.basename(filePath)}

Sample content for demonstration:
- Demographics section
- Background and SMA management questions
- Category ranking exercises
- Treatment effectiveness categories
- Safety and efficacy discussions

Please note: This is a simplified extraction. For full functionality, ensure mammoth package is installed.`;
    }
  } catch (error) {
    console.error('Error extracting text from docx:', error);
    throw new Error('Failed to extract text from document');
  }
}