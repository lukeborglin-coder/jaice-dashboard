import { useState, useCallback, useEffect } from 'react';
import { API_BASE_URL } from '../config';

interface UseQuestionnaireProps {
  selectedProject?: any | null;
  onLoadingChange?: (loading: boolean) => void;
}

export const useQuestionnaire = (props?: UseQuestionnaireProps) => {
  const { selectedProject, onLoadingChange } = props || {};
  
  const [questionnaires, setQuestionnaires] = useState<any[]>([]);
  const [selectedQuestionnaire, setSelectedQuestionnaire] = useState<any | null>(null);
  const [questionnaireQuestions, setQuestionnaireQuestions] = useState<any[]>([]);
  const [allQuestionnaires, setAllQuestionnaires] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Helper function to migrate Open End questions with statementOptions to Open End List
  const migrateOpenEndQuestions = useCallback((questions: any[]) => {
    return questions.map((q: any) => {
      const isOpenEnd = q.type?.toLowerCase() === 'open end' || 
                       (q.type?.toLowerCase().includes('open end') && !q.type?.toLowerCase().includes('list'));
      const hasStatementOptions = q.statementOptions && Array.isArray(q.statementOptions) && q.statementOptions.length > 0;
      if (isOpenEnd && hasStatementOptions) {
        const migrated = { ...q };
        migrated.type = 'Open End List';
        // Move statementOptions to responseOptions if responseOptions doesn't exist
        if (!migrated.responseOptions || migrated.responseOptions.length === 0) {
          migrated.responseOptions = migrated.statementOptions;
        }
        // Clear statementOptions
        migrated.statementOptions = undefined;
        return migrated;
      }
      return q;
    });
  }, []);

  // Load all questionnaires to get counts
  useEffect(() => {
    const loadAllQuestionnaires = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/questionnaire/all`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
        });
        if (response.ok) {
          const data = await response.json();
          setAllQuestionnaires(data || []);
        }
      } catch (error) {
        // Silent fail
      }
    };
    loadAllQuestionnaires();
  }, []);

  // Load questionnaires for a project
  const loadQuestionnaires = useCallback(async (projectId: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/questionnaire/${projectId}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
      });
      if (response.ok) {
        const data = await response.json();
        setQuestionnaires(data || []);
      }
    } catch (error) {
      setQuestionnaires([]);
    }
  }, []);

  // Load questions for selected questionnaire
  useEffect(() => {
    if (!selectedQuestionnaire) {
      setQuestionnaireQuestions([]);
      return;
    }

    // Helper function to migrate Open End questions
    const migrateOpenEndQuestions = (questions: any[]) => {
      return questions.map((q: any) => {
        const isOpenEnd = q.type?.toLowerCase() === 'open end' || 
                         (q.type?.toLowerCase().includes('open end') && !q.type?.toLowerCase().includes('list'));
        const hasStatementOptions = q.statementOptions && Array.isArray(q.statementOptions) && q.statementOptions.length > 0;
        if (isOpenEnd && hasStatementOptions) {
          const migrated = { ...q };
          migrated.type = 'Open End List';
          if (!migrated.responseOptions || migrated.responseOptions.length === 0) {
            migrated.responseOptions = migrated.statementOptions;
          }
          migrated.statementOptions = undefined;
          return migrated;
        }
        return q;
      });
    };
    
    // First check if the questionnaire already has questions
    if (selectedQuestionnaire.questions && selectedQuestionnaire.questions.length > 0) {
      setQuestionnaireQuestions(migrateOpenEndQuestions(selectedQuestionnaire.questions));
      return;
    }
    
    // If not, try to find it in allQuestionnaires
    if (allQuestionnaires.length > 0) {
      const fullQnr = allQuestionnaires.find(q => q.id === selectedQuestionnaire.id);
      if (fullQnr && fullQnr.questions && fullQnr.questions.length > 0) {
        setQuestionnaireQuestions(migrateOpenEndQuestions(fullQnr.questions));
        return;
      }
    }
    
    // If still not found, try to load from the project's questionnaires
    if (selectedProject) {
      const loadQuestions = async () => {
        setLoading(true);
        if (onLoadingChange) onLoadingChange(true);
        try {
          const response = await fetch(`${API_BASE_URL}/api/questionnaire/${selectedProject.id}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
          });
          if (response.ok) {
            const projectQuestionnaires = await response.json();
            const fullQnr = projectQuestionnaires.find((q: any) => q.id === selectedQuestionnaire.id);
            if (fullQnr && fullQnr.questions && fullQnr.questions.length > 0) {
              setQuestionnaireQuestions(migrateOpenEndQuestions(fullQnr.questions));
            }
          }
        } catch (error) {
          // Silent fail
        } finally {
          setLoading(false);
          if (onLoadingChange) onLoadingChange(false);
        }
      };
      loadQuestions();
    }
  }, [selectedQuestionnaire, selectedProject, allQuestionnaires, onLoadingChange]);

  // Get QNR count for a project
  const getQNRCount = useCallback((projectId: string) => {
    return allQuestionnaires.filter(q => q.projectId === projectId).length;
  }, [allQuestionnaires]);

  return {
    questionnaires,
    selectedQuestionnaire,
    questionnaireQuestions,
    allQuestionnaires,
    loading,
    loadQuestionnaires,
    getQNRCount,
    migrateOpenEndQuestions,
    setQuestionnaires,
    setSelectedQuestionnaire,
    setQuestionnaireQuestions,
    setAllQuestionnaires,
  };
};

