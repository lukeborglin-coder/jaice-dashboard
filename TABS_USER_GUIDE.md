# Tabs Feature - User Testing Guide

## Prerequisites

Before you can create and configure tabs, ensure you have:

- [ ] **Uploaded your data file** (Excel/CSV with survey responses)
- [ ] **Uploaded your questionnaire** (QNR file with question definitions)
- [ ] Both files processed successfully (check Data Quality page)
- [ ] Project created and accessible from the Tabs page

---

## Creating Your First Tab Plan

### Step 1: Navigate to Tabs
1. Go to the **Tabs** page from the main navigation
2. Select your project from the project list
3. Click **"Create New Tab Plan"** button

### Step 2: Set Up Basic Information
- [ ] Enter a descriptive **Tab Plan Name** (e.g., "Wave 1 Tables", "Q4 Analysis")
- [ ] Select your **data file** from the dropdown
- [ ] Select your **questionnaire** from the dropdown
- [ ] Click **"Create"** to initialize the tab plan

---

## Configuring Table Specs

Table specs define which questions/variables will be tabulated and how they appear.

### Accessing Table Specs
1. Open your tab plan
2. Click on the **"Table Specs"** tab at the top
3. You'll see a list of all available variables from your data

### Understanding the Table Specs Interface

**Left Panel - Variable List:**
- Shows all questions/variables from your questionnaire
- Search bar at top to filter variables
- Variables are organized by question number

**Right Panel - Spec Details:**
- Click any variable to view/edit its specifications
- Configure how the variable appears in tables

### Configuring Individual Table Specs

For each variable, you can configure:

#### Basic Settings
- [ ] **Variable Name** - The internal name (usually matches questionnaire)
- [ ] **Table Title** - How it appears in the final table
- [ ] **Description** - Additional context about the question

#### Response Options
- [ ] **Add/Edit Response Codes** - Define what responses are valid
- [ ] **Response Labels** - Set display text for each code
- [ ] **Reorder Responses** - Drag to change order in tables

#### Advanced Options
- [ ] **Base Definition** - Define who should be included in the base (denominator)
- [ ] **Hide from Tables** - Toggle to exclude a variable from exports
- [ ] **Significance Testing** - Enable statistical testing if needed

### Downloading Table Specs
- [ ] Click **"Download Table Specs"** button (bottom right)
- [ ] This creates an Excel file with all your current specifications
- [ ] Use this as a backup or to review specs offline

---

## Configuring Banner Specs

Banner specs define the columns that appear across your cross-tabulation tables (demographics, segments, etc.).

### Accessing Banner Specs
1. Open your tab plan
2. Click on the **"Banner Specs"** tab at the top
3. You'll see your existing banner groups (or empty state)

### Option A: Import Banner Specs from Excel Template

**Recommended for first-time setup**

1. Click the **ⓘ (info icon)** next to "Import Banner Specs"
2. In the popup, click **"Download Template"**
3. Open the downloaded Excel file

#### Filling Out the Template

The template has 3 columns:

| BANNER HEADING | BANNER POINT | BANNER DEFINITION |
|----------------|--------------|-------------------|
| Total | | |
| Gender | Male | S4=1 |
| | Female | S4=2 |
| Age Group | 18-34 | S3=18-34 |
| | 35-54 | S3=35-54 |
| | 55+ | S3=55-99 |

**Rules:**
- [ ] **BANNER HEADING** - The category name (Gender, Age, Region, etc.)
  - Enter once for each new category
  - Leave blank to continue the previous heading
- [ ] **BANNER POINT** - The specific segment (Male, Female, etc.)
  - Required for each row
- [ ] **BANNER DEFINITION** - The data condition (optional)
  - Syntax: `VariableName=Code` (e.g., `S4=1` for Male)
  - Use `=` for exact match
  - Use `-` for ranges (e.g., `S3=18-34`)
  - Leave blank to let AI auto-configure
- [ ] Add `Total` as the first row if you want a Total column

#### Import the File
4. Save your Excel file
5. Click **"Import Banner Specs"** button
6. Select your file
7. Wait for AI auto-configuration to complete (10-30 seconds)

### Option B: Create Banners Manually

1. Click **"Create Banner Group"** button
2. Enter a name for the banner group
3. Click **"Add Subgroup"** to create categories
4. For each subgroup:
   - [ ] Enter the subgroup title (e.g., "Gender")
   - [ ] Click **"Add Cut"** to add segments
   - [ ] Enter the cut title (e.g., "Male")
   - [ ] Click **"Configure"** to set the data condition

### Configuring Banner Conditions

When you click **"Configure"** on a banner cut:

#### For Categorical Variables (Single/Multi-select)
1. Select the variable from the dropdown
2. Check the boxes for the codes you want to include
3. Click **"Save"**

#### For Numeric Variables
1. Select the variable from the dropdown
2. Choose the operator (>=, <=, =, between, etc.)
3. Enter the numeric value(s)
4. Click **"Save"**

#### For Multiple Conditions (OR/AND logic)
1. Click **"+ Add Condition"** after configuring the first condition
2. Toggle between **OR** and **AND** at the top
3. Configure each condition
4. Click **"Save"**

### Special Features

#### Numeric Grid Variables (Multiple Columns)
If you have numeric grid questions (like S14 with multiple response columns):
- [ ] These will appear as individual cells: `S14r1c1`, `S14r2c1`, etc.
- [ ] Each cell represents: Row × Column combination
- [ ] Select the specific cells you need for conditions

#### Including Total Column
- [ ] Toggle **"Include Total"** checkbox at the top of the banner builder
- [ ] This adds a Total column to all your tables

### Saving Your Banners
- [ ] Click **"Save"** button (bottom right) when done
- [ ] Your banner groups are saved automatically to the project

---

## Downloading/Exporting Tables

### Download All Tables
1. Go to the **Data** tab in your tab plan
2. Click **"Download All Tables"** button at the top
3. Wait for the export to process
4. An Excel file will download with all tables

### Download Specific Banner Tables
1. Go to the **Banner Specs** tab
2. Find the banner group you want to export
3. Click the **download icon** (⬇️) next to that banner
4. Wait for processing
5. Excel file downloads with tables for that banner only

### Understanding the Export Format

Each table in the Excel file includes:
- **3-row header**: Table number, question text, and column labels
- **Rows**: Response options with counts and percentages
- **Columns**: Your banner points (demographics, segments, etc.)
- **Base row**: Total respondents for each column
- **Significance markers**: Letters indicating statistical differences (if enabled)

---

## Troubleshooting Guide

### Issue: "No variables showing in Table Specs"
**Cause:** Data or questionnaire not loaded properly

**Solutions:**
- [ ] Check that both data file and questionnaire are selected
- [ ] Verify files were uploaded successfully in Data Quality page
- [ ] Refresh the page
- [ ] Try re-uploading the questionnaire

### Issue: "Numeric grid variables not appearing in banner configuration"
**Cause:** Variables with multiple columns need special handling

**Solutions:**
- [ ] Look for cell-level variables (e.g., `QS14r1c1` instead of just `QS14`)
- [ ] These represent individual row×column combinations
- [ ] Search for the base variable name in the Configure dropdown
- [ ] Refresh the page to ensure latest variable extraction

### Issue: "AI auto-configuration failed on banner import"
**Cause:** Variable names in Excel don't match data columns

**Solutions:**
- [ ] Check your Excel "BANNER DEFINITION" column syntax
- [ ] Use exact variable names from your data (check Data tab)
- [ ] Try leaving definitions blank and let AI configure automatically
- [ ] Check console for specific error messages

### Issue: "Tables show zero counts for all cells"
**Cause:** Banner conditions don't match any data

**Solutions:**
- [ ] Click "Configure" on the banner point and verify the condition
- [ ] Check that variable names match your data exactly (case-sensitive)
- [ ] Verify code values match your actual data (check Data tab)
- [ ] Look for sample size shown in Configure modal - should be > 0

### Issue: "Download button not working / Excel not downloading"
**Cause:** Browser blocking download or processing error

**Solutions:**
- [ ] Check browser console for errors (F12)
- [ ] Ensure you have banner groups configured
- [ ] Try a different browser
- [ ] Check that base counts are calculating (view in Data tab)
- [ ] Verify your data has responses for the banner conditions

### Issue: "Variables showing duplicate entries"
**Cause:** Grid questions create multiple rows

**Solutions:**
- [ ] This is expected for grid questions (one entry per row or column)
- [ ] Filter using the search bar to find the specific variable you need
- [ ] Check the variable type to understand the structure

### Issue: "Can't find a specific variable in banner configuration"
**Cause:** Variable might be filtered or not in expected headers

**Solutions:**
- [ ] Use the search bar in the Configure modal
- [ ] Check if it's a numeric grid - look for cell-level names
- [ ] Verify the variable exists in your data (Data tab)
- [ ] Refresh the page to rebuild variable list

### Issue: "Imported banner specs not saving"
**Cause:** Validation errors or missing data

**Solutions:**
- [ ] Wait for AI configuration to complete fully (loading spinner)
- [ ] Check that all required columns are in your Excel template
- [ ] Ensure you clicked "Save" after import
- [ ] Check console for validation errors

---

## Best Practices

### Before Starting
- [ ] Review your data in the Data tab to understand variable names and codes
- [ ] Create a list of banner specifications you want (demographics, segments, etc.)
- [ ] Have your questionnaire handy for reference

### When Creating Banners
- [ ] Start with the Excel template method - it's faster and more reliable
- [ ] Leave banner definitions blank if unsure - AI will auto-configure
- [ ] Test with a simple banner first (just Gender and Age) before adding more
- [ ] Use descriptive names for banner groups (e.g., "Demographics", "Product Usage")

### When Configuring Conditions
- [ ] Always check the sample size shown in the Configure modal
- [ ] Use the preview to verify conditions match what you expect
- [ ] For complex conditions, use the OR/AND functionality
- [ ] Test your banner by downloading tables to verify results

### Data Quality
- [ ] Ensure your data file is clean (no extra header rows, consistent coding)
- [ ] Verify your questionnaire matches your data file structure
- [ ] Check for unmapped questions in Data Quality page
- [ ] Review base counts to ensure segments have adequate sample sizes

---

## Quick Reference: Banner Definition Syntax

When manually entering banner definitions in Excel or configure modal:

| Type | Syntax | Example | Description |
|------|--------|---------|-------------|
| Single code | `Var=Code` | `S4=1` | Gender = Male |
| Multiple codes | `Var=Code1,Code2` | `S4=1,2` | Gender = Male or Female |
| Range | `Var=Min-Max` | `S3=18-34` | Age between 18-34 |
| Numeric condition | `Var>Value` | `S14r1c1>0` | Any response in cell |
| OR conditions | `Var1=Code OR Var2=Code` | `S4=1 OR S5=2` | Male OR High Income |
| AND conditions | `Var1=Code AND Var2=Code` | `S4=1 AND S5=2` | Male AND High Income |

---

## Getting Help

If you encounter issues not covered in this guide:

1. **Check the console** (F12 in browser) for error messages
2. **Review the Data tab** to verify your data structure
3. **Try the simplest case first** (one banner with one cut)
4. **Note the exact error message** or behavior
5. **Document steps to reproduce** the issue

---

## Appendix: Common Variable Types

Understanding variable types helps with configuration:

| Type | Description | Example Use |
|------|-------------|-------------|
| **Single select** | One answer per question | Gender, Age Group |
| **Multi-select** | Multiple answers allowed | Brand awareness, Features used |
| **Single select grid** | Grid with one answer per row | Satisfaction ratings |
| **Multi-select grid** | Grid with multiple answers per row | Product features matrix |
| **Numeric** | Number entry | Age (exact), Income |
| **Numeric grid** | Grid with numbers in cells | Allocation percentages |
| **Numeric grid cell** | Individual cell in numeric grid | `QS14r1c1` = Row 1, Column 1 |

---

**Version:** 1.0
**Last Updated:** January 2026
