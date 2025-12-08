import React from 'react';

interface FormatQuoteTextOptions {
  /**
   * If true, normalizes all speakers to "Moderator" or "Respondent"
   * If false, preserves original speaker names
   */
  normalizeSpeakers?: boolean;
}

/**
 * Formats quote text with bold speaker tags and italicized content.
 * Handles multiple speakers per line and speaker normalization.
 * 
 * @param text - The quote text to format
 * @param options - Formatting options
 * @returns JSX elements with formatted quote text
 */
export function formatQuoteText(text: string, options: FormatQuoteTextOptions = {}): JSX.Element {
  const { normalizeSpeakers = false } = options;
  
  // First, split by lines
  const lines = text.split('\n');
  const allElements: JSX.Element[] = [];
  let key = 0;

  lines.forEach((line, lineIndex) => {
    // Check if line contains multiple speakers
    // Use broader pattern for Storytelling (handles R01, R02, etc.), 
    // more specific for ContentAnalysis
    const speakerPattern = normalizeSpeakers 
      ? /([A-Za-z0-9]+):\s*/gi  // Broader pattern for normalization
      : /(Moderator|Respondent|Interviewer|Participant):\s*/gi;  // Specific pattern
    
    const matches = [...line.matchAll(speakerPattern)];
    
    if (matches.length > 1) {
      // Multiple speakers on same line - split them
      matches.forEach((match, matchIndex) => {
        const speaker = match[1];
        const startPos = match.index!;
        const endPos = matchIndex < matches.length - 1 ? matches[matchIndex + 1].index! : line.length;
        const content = line.substring(startPos + match[0].length, endPos).trim();
        
        // Add line break before each speaker except the first
        if (matchIndex > 0) {
          allElements.push(<br key={key++} />);
        }
        
        // Normalize speaker names if requested
        let displaySpeaker = speaker;
        if (normalizeSpeakers) {
          if (speaker.toLowerCase() === 'interviewer' || speaker.toLowerCase() === 'moderator') {
            displaySpeaker = 'Moderator';
          } else {
            // ALL other speakers (R01, R02, actual names like "Elsie", etc.) become "Respondent"
            displaySpeaker = 'Respondent';
          }
        } else {
          // Capitalize first letter, lowercase rest
          displaySpeaker = speaker.charAt(0).toUpperCase() + speaker.slice(1).toLowerCase();
        }
        
        allElements.push(
          <React.Fragment key={key++}>
            <strong>{displaySpeaker}:</strong> <em>{content}</em>
          </React.Fragment>
        );
      });
    } else if (matches.length === 1) {
      // Single speaker on line
      const match = matches[0];
      const speaker = match[1];
      const content = line.substring(match[0].length).trim();
      
      // Normalize speaker names if requested
      let displaySpeaker = speaker;
      if (normalizeSpeakers) {
        if (speaker.toLowerCase() === 'interviewer' || speaker.toLowerCase() === 'moderator') {
          displaySpeaker = 'Moderator';
        } else {
          // ALL other speakers become "Respondent"
          displaySpeaker = 'Respondent';
        }
      } else {
        // Capitalize first letter, lowercase rest
        displaySpeaker = speaker.charAt(0).toUpperCase() + speaker.slice(1).toLowerCase();
      }
      
      allElements.push(
        <React.Fragment key={key++}>
          <strong>{displaySpeaker}:</strong> <em>{content}</em>
        </React.Fragment>
      );
    } else {
      // No speaker pattern - regular text
      allElements.push(
        <React.Fragment key={key++}>
          {line}
        </React.Fragment>
      );
    }
    
    // Add line break between different lines
    if (lineIndex < lines.length - 1) {
      allElements.push(<br key={key++} />);
    }
  });

  return <>{allElements}</>;
}

