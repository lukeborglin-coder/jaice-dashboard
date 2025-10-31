export type ConflictSource = 'project' | 'custom';

export type Conflict = {
  source: ConflictSource;
  label: string;
  startDate: string;
  endDate: string;
};

export type ModeratorLike = {
  id?: string;
  name?: string;
  customSchedule?: Array<{
    id?: string;
    startDate: string;
    endDate: string;
    type: 'booked' | 'pending' | 'unavailable';
    projectName?: string;
  }>;
};

export type ProjectLike = {
  id: string;
  name: string;
  moderator?: string;
  segments?: Array<{ phase: string; startDate: string; endDate: string }>;
};

function rangesOverlap(aStart: string | undefined, aEnd: string | undefined, bStart: string | undefined, bEnd: string | undefined): boolean {
  if (!aStart || !aEnd || !bStart || !bEnd) return false;
  return !(aEnd < bStart || bEnd < aStart);
}

function getFieldingRange(project: ProjectLike): { start?: string; end?: string } {
  const seg = project.segments?.find(s => s.phase === 'Fielding');
  return { start: seg?.startDate, end: seg?.endDate };
}

export function checkModeratorAvailability(
  moderator: ModeratorLike,
  fieldStart: string | undefined,
  fieldEnd: string | undefined,
  allProjects: ProjectLike[],
  options?: { treatPendingAsBlocking?: boolean }
): { ok: boolean; conflicts: Conflict[] } {
  const treatPendingAsBlocking = options?.treatPendingAsBlocking ?? true;

  const conflicts: Conflict[] = [];
  if (!fieldStart || !fieldEnd) {
    return { ok: true, conflicts };
  }

  const moderatorId = moderator.id;
  const moderatorName = moderator.name;

  // Project-based conflicts
  for (const project of allProjects) {
    const assignedToThis = project.moderator === moderatorId || project.moderator === moderatorName;
    if (!assignedToThis) continue;
    const { start, end } = getFieldingRange(project);
    if (rangesOverlap(fieldStart, fieldEnd, start, end)) {
      conflicts.push({
        source: 'project',
        label: project.name,
        startDate: start || '',
        endDate: end || ''
      });
    }
  }

  // Custom schedule conflicts
  for (const entry of moderator.customSchedule || []) {
    const isBlocking = entry.type === 'booked' || (treatPendingAsBlocking && entry.type === 'pending') || entry.type === 'unavailable';
    if (!isBlocking) continue;
    if (rangesOverlap(fieldStart, fieldEnd, entry.startDate, entry.endDate)) {
      conflicts.push({
        source: 'custom',
        label: entry.projectName || (entry.type === 'pending' ? 'PENDING HOLD' : 'Unavailable'),
        startDate: entry.startDate,
        endDate: entry.endDate
      });
    }
  }

  return { ok: conflicts.length === 0, conflicts };
}

export function formatConflicts(conflicts: Conflict[]): string {
  if (!conflicts.length) return '';
  return conflicts
    .map(c => `${c.source === 'project' ? 'Project' : 'Schedule'}: ${c.label} (${c.startDate} - ${c.endDate})`)
    .join('\n');
}






