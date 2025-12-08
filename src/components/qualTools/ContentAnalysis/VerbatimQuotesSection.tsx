import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../../config';
import { formatQuoteText } from '../../../utils/qualTools/quoteFormatting';

interface VerbatimQuote {
  text: string;
  context: string;
}

interface VerbatimQuotesSectionProps {
  analysisId: string;
  respondentId: string;
  columnName: string;
  sheetName: string;
  keyFinding: string;
  onRefreshQuotes?: () => void;
}

export default function VerbatimQuotesSection({ 
  analysisId, 
  respondentId, 
  columnName, 
  sheetName, 
  keyFinding, 
  onRefreshQuotes 
}: VerbatimQuotesSectionProps) {
  const [quotes, setQuotes] = useState<VerbatimQuote[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcriptType, setTranscriptType] = useState<string>('');
  const [noAdditionalQuotes, setNoAdditionalQuotes] = useState(false);
  const [showNoAdditionalNote, setShowNoAdditionalNote] = useState(false);

  useEffect(() => {
    if (analysisId && respondentId && columnName && sheetName && keyFinding) {
      fetchVerbatimQuotes();
    }
  }, [analysisId, respondentId, columnName, sheetName, keyFinding]);

  const fetchVerbatimQuotes = async (excludePrevious = false) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/caX/get-verbatim-quotes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
        },
        body: JSON.stringify({
          analysisId,
          respondentId,
          columnName,
          sheetName,
          keyFinding,
          excludePrevious: excludePrevious,
          previouslyShownQuotes: excludePrevious ? quotes : []
        })
      });

      if (response.ok) {
        const data = await response.json();
        setQuotes(data.quotes || []);
        setTranscriptType(data.transcriptType || '');
        
        // Handle no additional quotes flag
        if (data.noAdditionalQuotes) {
          setNoAdditionalQuotes(true);
          setShowNoAdditionalNote(true);
          // Clear the note after 5 seconds
          setTimeout(() => {
            setShowNoAdditionalNote(false);
          }, 5000);
        } else {
          setNoAdditionalQuotes(false);
          setShowNoAdditionalNote(false);
        }
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to fetch quotes');
      }
    } catch (err) {
      setError('Network error while fetching quotes');
      console.error('Error fetching verbatim quotes:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-blue-900 mb-2">Loading Supporting Quotes...</h3>
        <div className="flex items-center space-x-2">
          <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          <span className="text-sm text-gray-600">Finding relevant quotes from transcript...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-red-900 mb-2">Error Loading Quotes</h3>
        <p className="text-sm text-red-700">{error}</p>
        <button
          onClick={() => fetchVerbatimQuotes()}
          className="mt-2 text-xs text-red-600 hover:text-red-800 underline"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (quotes.length === 0) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">No Supporting Quotes Found</h3>
        <p className="text-sm text-gray-600">
          No verbatim quotes were found for this finding. Try refreshing or adjusting the key finding text.
        </p>
        <button
          onClick={() => fetchVerbatimQuotes()}
          className="mt-2 text-xs text-gray-600 hover:text-gray-800 underline"
        >
          Refresh Quotes
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900">
          Supporting Quotes ({quotes.length})
        </h3>
        <div className="flex items-center gap-2">
          {showNoAdditionalNote && (
            <span className="text-xs text-gray-500 italic">
              No additional quotes available
            </span>
          )}
          <button
            onClick={() => fetchVerbatimQuotes(true)}
            disabled={noAdditionalQuotes}
            className="text-xs text-blue-600 hover:text-blue-800 underline disabled:text-gray-400 disabled:cursor-not-allowed"
          >
            Get More Quotes
          </button>
          {onRefreshQuotes && (
            <button
              onClick={onRefreshQuotes}
              className="text-xs text-blue-600 hover:text-blue-800 underline"
            >
              Refresh All
            </button>
          )}
        </div>
      </div>
      
      {transcriptType && (
        <p className="text-xs text-gray-500 mb-3">
          Source: {transcriptType}
        </p>
      )}

      <div className="space-y-4">
        {quotes.map((quote, index) => (
          <div key={index} className="bg-blue-50 border-l-4 border-blue-500 rounded p-3">
            <div className="text-sm text-gray-800 leading-relaxed">
              {formatQuoteText(quote.text, { normalizeSpeakers: false })}
            </div>
            {quote.context && (
              <div className="mt-2 text-xs text-gray-600 italic">
                {quote.context}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

