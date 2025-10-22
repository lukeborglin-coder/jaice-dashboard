/**
 * Date calculation utility for JAICE tasks based on project timeline
 */

export interface ProjectTimeline {
  koDate: string;           // Project KO date (YYYY-MM-DD)
  fieldworkStart: string;   // Fieldwork start date (YYYY-MM-DD)
  fieldworkEnd: string;     // Fieldwork end date (YYYY-MM-DD)
  reportDue: string;        // Final report due date (YYYY-MM-DD)
}

export interface TaskWithDateNotes {
  id: string;
  dateNotes: string;
  task: string;
  phase: string;
}

/**
 * Calculate the actual due date for a task based on its dateNotes and project timeline
 */
export function calculateTaskDueDate(
  task: TaskWithDateNotes,
  timeline: ProjectTimeline
): string | null {
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
    // KO date patterns
    if (normalizedNotes.includes('ko date')) {
      const koDate = new Date(timeline.koDate + 'T00:00:00');
      
      if (normalizedNotes.includes('1 day before')) {
        const businessDay = getPreviousBusinessDay(koDate);
        return formatDate(businessDay);
      }
    }

    // Fieldwork start patterns
    if (normalizedNotes.includes('fieldwork start') || normalizedNotes.includes('first day of fieldwork')) {
      const fieldworkStart = new Date(timeline.fieldworkStart + 'T00:00:00');
      
      if (normalizedNotes.includes('1 day before')) {
        const businessDay = getPreviousBusinessDay(fieldworkStart);
        return formatDate(businessDay);
      } else if (normalizedNotes.includes('first day of')) {
        return formatDate(fieldworkStart);
      }
    }

    // Fieldwork end patterns
    if (normalizedNotes.includes('fieldwork ends') || normalizedNotes.includes('last day of field')) {
      const fieldworkEnd = new Date(timeline.fieldworkEnd + 'T00:00:00');
      
      if (normalizedNotes.includes('1 day after')) {
        const businessDay = getNextBusinessDay(fieldworkEnd);
        return formatDate(businessDay);
      } else if (normalizedNotes.includes('last day of')) {
        return formatDate(fieldworkEnd);
      }
    }

    // Pre-field patterns
    if (normalizedNotes.includes('pre-field')) {
      const fieldworkStart = new Date(timeline.fieldworkStart + 'T00:00:00');
      
      if (normalizedNotes.includes('first day of')) {
        // Pre-field typically starts 1 week before fieldwork
        fieldworkStart.setUTCDate(fieldworkStart.getUTCDate() - 7);
        return formatDate(fieldworkStart);
      }
    }

    // Week prior patterns
    if (normalizedNotes.includes('1 week prior to fieldwork start')) {
      const fieldworkStart = new Date(timeline.fieldworkStart + 'T00:00:00');
      fieldworkStart.setUTCDate(fieldworkStart.getUTCDate() - 7);
      return formatDate(fieldworkStart);
    }

    // First day of field patterns
    if (normalizedNotes.includes('first day of field')) {
      const fieldworkStart = new Date(timeline.fieldworkStart + 'T00:00:00');
      
      if (normalizedNotes.includes('1 day before')) {
        const businessDay = getPreviousBusinessDay(fieldworkStart);
        return formatDate(businessDay);
      } else {
        return formatDate(fieldworkStart);
      }
    }

    // Post-field patterns
    if (normalizedNotes.includes('post-field')) {
      const fieldworkEnd = new Date(timeline.fieldworkEnd + 'T00:00:00');
      
      if (normalizedNotes.includes('first day of')) {
        // Post-field typically starts 1 day after fieldwork ends
        const businessDay = getNextBusinessDay(fieldworkEnd);
        return formatDate(businessDay);
      }
    }

    // Report due date patterns
    if (normalizedNotes.includes('report due date')) {
      const reportDue = new Date(timeline.reportDue + 'T00:00:00');
      
      if (normalizedNotes.includes('1 day before')) {
        const businessDay = getPreviousBusinessDay(reportDue);
        return formatDate(businessDay);
      } else if (normalizedNotes.includes('final')) {
        return formatDate(reportDue);
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

/**
 * Format a Date object to YYYY-MM-DD string using UTC methods to avoid timezone issues
 */
function formatDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get the next business day (skip weekends)
 */
function getNextBusinessDay(date: Date): Date {
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

/**
 * Get the previous business day (skip weekends)
 */
function getPreviousBusinessDay(date: Date): Date {
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

/**
 * Calculate due dates for multiple tasks
 */
export function calculateTaskDueDates(
  tasks: TaskWithDateNotes[],
  timeline: ProjectTimeline
): Array<{ taskId: string; dueDate: string | null }> {
  return tasks.map(task => ({
    taskId: task.id,
    dueDate: calculateTaskDueDate(task, timeline)
  }));
}
