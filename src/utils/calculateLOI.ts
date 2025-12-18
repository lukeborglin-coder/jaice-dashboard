export function calculateLOIMinutesFromQuestions(questions: any[] | null | undefined): number {
  if (!questions || !Array.isArray(questions) || questions.length === 0) return 0;

  // Match QNR overview behavior: exclude hidden variables (question number starts with 'hid_')
  const visibleQuestions = questions.filter((q: any) => !q?.number?.startsWith?.('hid_'));
  if (visibleQuestions.length === 0) return 0;

  let totalMinutes = 0;

  visibleQuestions.forEach((question: any) => {
    const typeLower = String(question?.type || '').toLowerCase();

    // Base time per question type (in minutes)
    let baseTime = 0.4; // Default 24 seconds

    if (typeLower.includes('single select')) {
      baseTime = 0.25; // 15 seconds
      // Add time for reading options (~1.5 seconds per option)
      const optionsCount = question?.options?.length || 0;
      baseTime += optionsCount * 0.025;
    } else if (typeLower.includes('multi-select')) {
      baseTime = 0.4; // 24 seconds
      // Add time for reading/selecting options (~2.5 seconds per option)
      const optionsCount = question?.options?.length || 0;
      baseTime += optionsCount * 0.042;
    } else if (typeLower.includes('open end')) {
      if (typeLower.includes('list')) {
        // Open end list - multiple text boxes
        baseTime = 0.8; // 48 seconds base
        const responseOptionsCount = question?.responseOptions?.length || 0;
        baseTime += responseOptionsCount * 0.4; // 24 seconds per text box
      } else {
        // Single open end
        baseTime = 0.8; // 48 seconds for typing
      }
    } else if (typeLower.includes('numeric')) {
      if (typeLower.includes('grid')) {
        baseTime = 0.3; // 18 seconds base
        const statementCount = question?.statementOptions?.length || 0;
        const responseCount = question?.responseOptions?.length || 0;
        baseTime += statementCount * responseCount * 0.04; // ~2.4 seconds per cell
      } else if (typeLower.includes('list')) {
        baseTime = 0.25; // 15 seconds base
        const responseOptionsCount = question?.responseOptions?.length || 0;
        baseTime += responseOptionsCount * 0.08; // ~5 seconds per numeric input
      } else {
        baseTime = 0.15; // 9 seconds
      }
    } else if (typeLower.includes('grid')) {
      baseTime = 0.4; // 24 seconds base
      const statementCount = question?.statementOptions?.length || 0;
      const responseCount = question?.responseOptions?.length || 0;
      // Grid questions take longer - need to read row and column
      baseTime += statementCount * responseCount * 0.067; // ~4 seconds per cell
    } else if (typeLower.includes('scale')) {
      baseTime = 0.35; // 21 seconds
      const optionsCount = question?.options?.length || 0;
      baseTime += optionsCount * 0.025; // ~1.5 seconds per option
    }

    totalMinutes += baseTime;
  });

  // Match QNR overview behavior: round to nearest minute
  return Math.round(totalMinutes);
}







