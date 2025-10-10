import React, { useState, useEffect } from 'react';

const API_BASE_URL = 'http://localhost:3005';

interface Project {
  id: string;
  name: string;
  timestamp: number;
}

interface CleanerProject {
  id: string;
  name: string;
  projectId: string;
  transcripts: CleanedTranscript[];
  createdAt: number;
}

interface CleanedTranscript {
  id: string;
  originalFilename: string;
  cleanedFilename: string;
  uploadedAt: number;
  respno?: string;
}

export default function TranscriptCleaner() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [cleanerProjects, setCleanerProjects] = useState<CleanerProject[]>([]);
  const [selectedCleaner, setSelectedCleaner] = useState<CleanerProject | null>(null);
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    loadProjects();
    loadCleanerProjects();
  }, []);

  const loadProjects = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/projects`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('jaice_token')}` }
      });
      if (response.ok) {
        const data = await response.json();
        setProjects(data);
      }
    } catch (error) {
      console.error('Failed to load projects:', error);
    }
  };

  const loadCleanerProjects = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/transcript-cleaner/projects`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('jaice_token')}` }
      });
      if (response.ok) {
        const data = await response.json();
        setCleanerProjects(data);
      }
    } catch (error) {
      console.error('Failed to load cleaner projects:', error);
    }
  };

  const handleCreateProject = async () => {
    if (!newProjectName.trim() || !selectedProjectId) {
      alert('Please enter a project name and select a project');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/transcript-cleaner/projects`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('jaice_token')}`
        },
        body: JSON.stringify({
          name: newProjectName,
          projectId: selectedProjectId
        })
      });

      if (response.ok) {
        const newProject = await response.json();
        setCleanerProjects([...cleanerProjects, newProject]);
        setShowNewProjectModal(false);
        setNewProjectName('');
        setSelectedProjectId('');
      } else {
        alert('Failed to create cleaner project');
      }
    } catch (error) {
      console.error('Failed to create cleaner project:', error);
      alert('Failed to create cleaner project');
    }
  };

  const handleUploadTranscript = async () => {
    if (!uploadFile || !selectedCleaner) {
      alert('Please select a file to upload');
      return;
    }

    setIsProcessing(true);

    try {
      const formData = new FormData();
      formData.append('transcript', uploadFile);
      formData.append('cleanerProjectId', selectedCleaner.id);

      const response = await fetch(`${API_BASE_URL}/api/transcript-cleaner/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('jaice_token')}`
        },
        body: formData
      });

      if (response.ok) {
        const result = await response.json();
        await loadCleanerProjects();
        const updated = cleanerProjects.find(p => p.id === selectedCleaner.id);
        if (updated) setSelectedCleaner(updated);
        setShowUploadModal(false);
        setUploadFile(null);
      } else {
        const error = await response.json();
        alert(`Failed to upload transcript: ${error.error}`);
      }
    } catch (error) {
      console.error('Failed to upload transcript:', error);
      alert('Failed to upload transcript');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownload = async (transcript: CleanedTranscript) => {
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/transcript-cleaner/download/${selectedCleaner?.id}/${transcript.id}`,
        {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('jaice_token')}` }
        }
      );

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = transcript.cleanedFilename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
    } catch (error) {
      console.error('Failed to download transcript:', error);
      alert('Failed to download transcript');
    }
  };

  if (selectedCleaner) {
    const linkedProject = projects.find(p => p.id === selectedCleaner.projectId);

    return (
      <div className="h-full flex flex-col bg-white">
        {/* Header */}
        <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => setSelectedCleaner(null)}
              className="text-gray-600 hover:text-gray-900"
            >
              ← Back
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{selectedCleaner.name}</h1>
              {linkedProject && (
                <p className="text-sm text-gray-500">Linked to: {linkedProject.name}</p>
              )}
            </div>
          </div>
          <button
            onClick={() => setShowUploadModal(true)}
            className="px-4 py-2 text-white rounded-lg hover:opacity-90"
            style={{ backgroundColor: '#D14A2D' }}
          >
            + Upload Transcript
          </button>
        </div>

        {/* Transcripts List */}
        <div className="flex-1 overflow-auto p-6">
          {selectedCleaner.transcripts.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              No transcripts uploaded yet. Click "Upload Transcript" to get started.
            </div>
          ) : (
            <div className="grid gap-4">
              {selectedCleaner.transcripts.map(transcript => (
                <div
                  key={transcript.id}
                  className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium text-gray-900">{transcript.originalFilename}</h3>
                      <p className="text-sm text-gray-500">
                        Cleaned: {new Date(transcript.uploadedAt).toLocaleString()}
                      </p>
                      {transcript.respno && (
                        <p className="text-sm text-gray-500">Respondent: {transcript.respno}</p>
                      )}
                    </div>
                    <button
                      onClick={() => handleDownload(transcript)}
                      className="px-4 py-2 text-white rounded-lg hover:opacity-90"
                      style={{ backgroundColor: '#D14A2D' }}
                    >
                      Download
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Upload Modal */}
        {showUploadModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-xl font-bold text-gray-900">Upload Transcript</h2>
              </div>

              <div className="p-6">
                {isProcessing ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="text-center">
                      <div className="w-16 h-16 mx-auto mb-4">
                        <svg className="animate-spin w-16 h-16" fill="none" viewBox="0 0 24 24" style={{ color: '#D14A2D' }}>
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                      </div>
                      <h3 className="text-lg font-semibold text-gray-900 mb-2">Cleaning Transcript</h3>
                      <p className="text-gray-600">This may take a minute...</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Select Transcript File (.docx or .txt)
                      </label>
                      <input
                        type="file"
                        accept=".docx,.txt"
                        onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                        className="block w-full text-sm text-gray-900 border border-gray-300 rounded-lg cursor-pointer bg-gray-50 focus:outline-none"
                      />
                    </div>
                  </div>
                )}
              </div>

              {!isProcessing && (
                <div className="px-6 py-4 border-t border-gray-200 flex justify-end space-x-3">
                  <button
                    onClick={() => {
                      setShowUploadModal(false);
                      setUploadFile(null);
                    }}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleUploadTranscript}
                    disabled={!uploadFile}
                    className="px-4 py-2 text-white rounded-lg hover:opacity-90 disabled:opacity-50"
                    style={{ backgroundColor: '#D14A2D' }}
                  >
                    Upload & Clean
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Transcript Cleaner</h1>
        <button
          onClick={() => setShowNewProjectModal(true)}
          className="px-4 py-2 text-white rounded-lg hover:opacity-90"
          style={{ backgroundColor: '#D14A2D' }}
        >
          + New Cleaner Project
        </button>
      </div>

      {/* Project List */}
      <div className="flex-1 overflow-auto p-6">
        {cleanerProjects.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            No cleaner projects yet. Click "New Cleaner Project" to create one.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {cleanerProjects.map(project => {
              const linkedProject = projects.find(p => p.id === project.projectId);
              return (
                <div
                  key={project.id}
                  onClick={() => setSelectedCleaner(project)}
                  className="border border-gray-200 rounded-lg p-6 hover:shadow-lg transition-shadow cursor-pointer"
                >
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">{project.name}</h3>
                  {linkedProject && (
                    <p className="text-sm text-gray-500 mb-2">Project: {linkedProject.name}</p>
                  )}
                  <p className="text-sm text-gray-500">
                    {project.transcripts.length} transcript{project.transcripts.length !== 1 ? 's' : ''}
                  </p>
                  <p className="text-xs text-gray-400 mt-2">
                    Created: {new Date(project.createdAt).toLocaleDateString()}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* New Project Modal */}
      {showNewProjectModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-xl font-bold text-gray-900">Create Cleaner Project</h2>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Project Name
                </label>
                <input
                  type="text"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="Enter project name..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#D14A2D]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Link to Project
                </label>
                <select
                  value={selectedProjectId}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#D14A2D]"
                >
                  <option value="">Select a project...</option>
                  {projects.map(project => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowNewProjectModal(false);
                  setNewProjectName('');
                  setSelectedProjectId('');
                }}
                className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateProject}
                className="px-4 py-2 text-white rounded-lg hover:opacity-90"
                style={{ backgroundColor: '#D14A2D' }}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
