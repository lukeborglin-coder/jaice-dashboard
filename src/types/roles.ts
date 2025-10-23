export type JaiceRole = {
  role: string;
  description: string;
};

export type JaiceTask = {
  id: string;
  quantQual?: string;
  phase: string;
  task: string;
  dateNotes?: string;
  role?: string;
  notes?: string;
};

export type TeamMemberWithRoles = {
  id: string;
  name: string;
  role: string; // Keep for backward compatibility
  roles: string[]; // New: multiple role assignment
};

export type Assignment = {
  taskId: string;
  assignedTo: string;
  role: string;
};

