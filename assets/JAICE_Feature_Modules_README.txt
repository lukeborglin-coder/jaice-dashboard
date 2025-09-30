JAICE Project Management Dashboard – Feature Module Plan
========================================================

These are **new features and adjustments** I want to make to my current site. Each **Module** below represents a bundle of related enhancements. Tackle them one at a time.

👉 After completing a module, mark it as ✅ DONE at the top of the section.

==================================================================
🎯 OVERVIEW: HOME DASHBOARD vs PROJECT HUB – CLEAR DIFFERENTIATION
==================================================================

The JAICE platform consists of **two core dashboard views**:

1. 🏠 **HOME DASHBOARD** (High-Level Overview)
   - Primary landing screen after login.
   - Designed for **individual users** to get an immediate sense of what's urgent, what they're working on, and where their projects stand.
   - **Vertical scroll layout** showing a **list of active projects**, ordered by recency and priority.
   - This is NOT for editing—just a clean summary view. Users click into a project to go deeper.

   Core elements:
   - "Your Week at a Glance": shows only tasks assigned to the logged-in user this week.
   - Project cards: vertical scroll list, minimal info shown (project title, phase, due dates).
   - Priority badges: Reporting phase = highest, shifts dynamically based on timeline/help request.
   - Clicking a project = navigate to that project’s **Project Hub dashboard**.

2. 🧠 **PROJECT HUB DASHBOARD** (Full Interactive Project Workspace)
   - This is the **detailed view per project**.
   - Users manage the timeline, phases, task list, documents, vendors, and objectives here.
   - Fully interactive. Editable. Designed for collaboration.
   - This is where admin or power users work.

   Core elements:
   - Top banner: Project name, methodology, background, objectives.
   - Linked SharePoint files + kickoff decks.
   - Vendor/moderator assignment and visibility.
   - Comments and feature request submission.

==================================================================
🗂 Module 1: Home Dashboard Revamp (🏠 HOME DASHBOARD)
==================================================================
- Convert card grid layout to a **vertical scroll list view**.
- Each project card displays:
  - Project name
  - Phase label (with color badge)
  - Timeline preview (ex: "Sept 18 – Oct 9")
  - Reporting request flag (if applicable)
- At top: "Your Week at a Glance" section with:
  - Tasks assigned to current user due this week
  - Any overdue items (highlighted)
  - Any help requests submitted for reporting, moderation, etc.
- **Priority logic**:
  - Auto-sort projects: Reporting > Fielding > Pre-Field > Closed
  - Boost projects with overdue tasks or pending help requests
- Priority pills: Green = low, Yellow = watch, Red = urgent
- Style: Minimal padding, pill badges, subtle hover shadows, Heroicons

==================================================================
📆 Module 2: Interactive Timeline Enhancements (🧠 PROJECT HUB)
==================================================================
- Default: show only **current week**
- Expandable via toggle to show full month view
- Scrollable left/right to view other months
- Colored icons mark key deadlines (e.g., Fielding Start, Reporting Due)
- Add “Edit” button:
  - Clicking unlocks drag-and-drop date ranges for each phase
  - Drag one phase = downstream phases shift automatically

==================================================================
✅ Module 3: Smart Task List System (🧠 PROJECT HUB)
==================================================================
- Load tasks based on selected methodology (Quant or Qual)
- Each phase includes default tasks (provided in a config file)
- Team can add/remove tasks per project
- Optional due dates per task (overdue if past due or past phase end)
- Notifications:
  - If assigned user exists: notify them
  - If unassigned: notify entire project team
- Task list display:
  - Assigned tasks shown first
  - Overdue tasks float to top
  - Completed tasks drop to bottom but remain visible
- Add R/Y/G pill indicator above list (project status)
- Display alert at top if overdue tasks exist

==================================================================
🛠 Module 4: Admin Controls + Login System (GLOBAL)
==================================================================
- Add login screen styled to match JAICE branding
  - Fields: email, password
  - Links: create account, forgot password
- Add user roles: Admin & User
- Admin-only “Admin Center” tab
  - Create/edit/remove users
  - Reset passwords
  - View submitted feature requests

==================================================================
💡 Module 5: Feature Request Center (GLOBAL)
==================================================================
- Sidebar item: “Submit Request”
  - Modal form: Type (Bug, Feature, Question), Title, Description
- Admin tab view:
  - Table of requests with status filters
  - Status: Not Reviewed / Considering / In Progress / Done
- Optional visibility toggle (to show/hide user-submitted requests)

==================================================================
📁 Module 6: File Management & SharePoint Integration (🧠 PROJECT HUB)
==================================================================
- In project hub, add SharePoint/OneDrive link uploader
  - Files shown with recognizable icons (e.g., Word, PPT, Excel)
- Upload kickoff deck
  - Backend parses for:
    - Timeline dates
    - Project background
    - Key objectives
- Parsing uses AI (OpenAI or Claude API)

==================================================================
🧑‍💼 Module 7: Vendor & Moderator Management (🧠 PROJECT HUB)
==================================================================
- During project setup, if Qual selected → prompt to assign moderator
- Moderator dropdown: add new or select existing
- Add “Moderator Schedule View” in Admin Center
  - Shows which moderators are booked and when
- Add “Vendor Library” tab
  - Tabs for: Moderators, Sample Vendors, Analytics
  - Each card:
    - Contact name + details
    - Past projects
    - Internal team notes (editable)

==================================================================
🧠 Module 8: Questionnaire Builder + Export Tools (NEW TAB)
==================================================================
- Add “Questionnaire” tab to sidebar
- Drag-and-drop builder:
  - Add questions inline
  - Add skip logic, terminates, quotas
  - Toggle to add [SPECIFY] tags or quotas via button
- Upload a screener or partial questionnaire
  - Parser continues even if some questions error
- Add preview button to test logic
- Export options:
  - Word doc (with programming notes inline)
  - Forsta-compatible XML

==================================================================
📝 Module 9: Project Setup Wizard (NEW PROJECT FLOW)
==================================================================
- Guided intake modal:
  - Project name
  - Methodology (Quant/Qual)
  - Start/End dates
  - Background
  - Objectives (rich text)
- AI-extract optional fields via kickoff deck
- Assign vendor/moderator inline
- Choose whether to start with preloaded tasks or custom
- Once created → redirects to full Project Hub view

==================================================================
🧼 Module 10: Design & UI Polish (GLOBAL)
==================================================================
- Use Tailwind CSS with:
  - Rounded cards (2xl radius)
  - Subtle hover shadows
  - Consistent paddings (p-4/p-6)
  - Color: JAICE orange + grey palette
- Icons from Heroicons
- Component types:
  - Pills for phase/status
  - Hover dropdowns
  - Resizable sidebars
  - Click-to-expand accordions for sections

==========================================================
Let me know when you're ready for:
- A ZIP with this README and starter folder structure
- Code preview by module (React, HTML, or Cursor-ready)
==========================================================