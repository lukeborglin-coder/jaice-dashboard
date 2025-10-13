import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon, DocumentTextIcon, BookOpenIcon, ChatBubbleLeftRightIcon, ExclamationTriangleIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { API_BASE_URL } from '../config';

interface FileOption {
  id: string;
  name: string;
  type: 'content_analysis' | 'discussion_guide' | 'transcript';
  size?: number;
  description: string;
  required?: boolean;
}

interface CostEstimate {
  inputTokens: number;
  outputTokens: number;
  cost: number;
  formattedCost: string;
}

interface StoryboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerate: (selectedFiles: string[], costEstimate: CostEstimate) => void;
  currentAnalysis: any;
  projectTranscripts: any[];
  discussionGuidePath?: string;
  generating?: boolean;
}

export default function StoryboardModal({
  isOpen,
  onClose,
  onGenerate,
  currentAnalysis,
  projectTranscripts,
  discussionGuidePath,
  generating = false
}: StoryboardModalProps) {
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [costEstimate, setCostEstimate] = useState<CostEstimate | null>(null);
  const [calculatingCost, setCalculatingCost] = useState(false);

  // Prepare file options with useMemo to prevent infinite re-renders
  const fileOptions: FileOption[] = useMemo(() => [
    {
      id: 'content_analysis',
      name: 'Content Analysis Data',
      type: 'content_analysis',
      description: 'Primary analysis data with key findings and insights',
      required: true
    },
    ...(discussionGuidePath ? [{
      id: 'discussion_guide',
      name: 'Discussion Guide',
      type: 'discussion_guide' as const,
      description: 'Original discussion guide with research objectives and questions'
    }] : []),
    ...projectTranscripts.map(transcript => ({
      id: transcript.id,
      name: transcript.originalFilename || `Transcript ${transcript.id}`,
      type: 'transcript' as const,
      size: transcript.originalSize,
      description: `Interview transcript - ${transcript.originalFilename}`
    }))
  ], [discussionGuidePath, projectTranscripts]);

  // Initialize with required files and auto-select discussion guide
  useEffect(() => {
    if (isOpen) {
      const requiredFiles = fileOptions.filter(f => f.required).map(f => f.id);
      const discussionGuideFile = fileOptions.find(f => f.type === 'discussion_guide');

      // Auto-select required files and discussion guide if available
      const initialFiles = discussionGuideFile
        ? [...requiredFiles, discussionGuideFile.id]
        : requiredFiles;

      setSelectedFiles(initialFiles);
    }
  }, [isOpen]); // Only reset when modal opens, not when fileOptions changes

  // Calculate cost estimate when selected files change (with debounce)
  useEffect(() => {
    if (selectedFiles.length > 0) {
      const timeoutId = setTimeout(() => {
        calculateCostEstimate();
      }, 500); // Debounce by 500ms
      
      return () => clearTimeout(timeoutId);
    }
  }, [selectedFiles]);

  const calculateCostEstimate = async () => {
    setCalculatingCost(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/caX/estimate-storyboard-cost`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('jaice_token')}`
        },
        body: JSON.stringify({
          selectedFiles,
          analysisId: currentAnalysis?.id,
          projectId: currentAnalysis?.projectId
        })
      });

      if (response.ok) {
        const text = await response.text();
        if (text) {
          const estimate = JSON.parse(text);
          setCostEstimate(estimate);
        } else {
          console.error('Empty response from server');
        }
      } else {
        const errorText = await response.text();
        console.error('Failed to calculate cost estimate:', response.status, errorText);
      }
    } catch (error) {
      console.error('Error calculating cost estimate:', error);
    } finally {
      setCalculatingCost(false);
    }
  };

  const handleFileToggle = (fileId: string) => {
    const file = fileOptions.find(f => f.id === fileId);
    if (file?.required) return; // Don't allow unchecking required files

    setSelectedFiles(prev => 
      prev.includes(fileId) 
        ? prev.filter(id => id !== fileId)
        : [...prev, fileId]
    );
  };

  const handleGenerate = () => {
    if (costEstimate) {
      console.log('📋 StoryboardModal - Selected files:', selectedFiles);
      console.log('📋 StoryboardModal - Discussion guide path:', discussionGuidePath);
      console.log('📋 StoryboardModal - File options:', fileOptions);
      onGenerate(selectedFiles, costEstimate);
    }
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '';
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
  };

  const getFileIcon = (type: string) => {
    switch (type) {
      case 'content_analysis':
        return <DocumentTextIcon className="h-5 w-5 text-blue-500" />;
      case 'discussion_guide':
        return <BookOpenIcon className="h-5 w-5 text-green-500" />;
      case 'transcript':
        return <ChatBubbleLeftRightIcon className="h-5 w-5 text-purple-500" />;
      default:
        return <DocumentTextIcon className="h-5 w-5 text-gray-500" />;
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">Generate Storyboard</h2>
          <button
            onClick={onClose}
            disabled={generating}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
          <div className="mb-6">
            <p className="text-sm text-gray-600 mb-4">
              Select the files you want to include in your storyboard. The AI will analyze these files to create a comprehensive report structure with key findings and recommendations.
            </p>
            
            {/* File Selection */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-gray-900">Available Files</h3>
              {fileOptions.map((file) => (
                <div
                  key={file.id}
                  className={`flex items-start space-x-3 p-3 rounded-lg border ${
                    selectedFiles.includes(file.id)
                      ? 'border-blue-200 bg-blue-50'
                      : 'border-gray-200 bg-white'
                  } ${file.required ? 'opacity-75' : 'cursor-pointer hover:border-gray-300'}`}
                  onClick={() => !file.required && handleFileToggle(file.id)}
                >
                  <div className="flex-shrink-0 mt-0.5">
                    {getFileIcon(file.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2">
                      <h4 className="text-sm font-medium text-gray-900">{file.name}</h4>
                      {file.required && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                          Required
                        </span>
                      )}
                      {file.size && (
                        <span className="text-xs text-gray-500">
                          {formatFileSize(file.size)}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{file.description}</p>
                  </div>
                  <div className="flex-shrink-0">
                    {file.required ? (
                      <CheckCircleIcon className="h-5 w-5 text-blue-500" />
                    ) : (
                      <input
                        type="checkbox"
                        checked={selectedFiles.includes(file.id)}
                        onChange={(e) => {
                          e.stopPropagation();
                          handleFileToggle(file.id);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Cost Estimate */}
          <div className="bg-gray-50 rounded-lg p-4">
            <h3 className="text-sm font-medium text-gray-900 mb-2">Cost Estimate</h3>
            {calculatingCost ? (
              <div className="flex items-center space-x-2 text-sm text-gray-600">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                <span>Calculating...</span>
              </div>
            ) : costEstimate ? (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Input tokens:</span>
                  <span className="font-medium">{costEstimate.inputTokens.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Estimated output tokens:</span>
                  <span className="font-medium">{costEstimate.outputTokens.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm font-medium border-t border-gray-200 pt-2">
                  <span className="text-gray-900">Total cost:</span>
                  <span className="text-green-600">{costEstimate.formattedCost}</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500">Select files to see cost estimate</p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onClose}
            disabled={generating}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            disabled={!costEstimate || generating || selectedFiles.length === 0}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {generating ? (
              <div className="flex items-center space-x-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                <span>Generating...</span>
              </div>
            ) : (
              'Generate Storyboard'
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
