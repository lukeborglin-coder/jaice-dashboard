import XLSX from 'xlsx';

/**
 * Parse a Forsta-style "Data Map" sheet from an Excel workbook file.
 * Returns the same payload shape currently used by /api/questionnaire/datamap/:id.
 *
 * Note: This intentionally mirrors the existing parsing behavior so that
 * tab-plan raw uploads and questionnaire uploads stay consistent.
 */
export async function parseDatamapFromExcelFile(filePath, options = {}) {
  const {
    rawDataPreviewRows = 50,
    rawDataPreviewRowsOnFailure = 100,
  } = options;

  const workbook = XLSX.readFile(filePath);

  const debugEnabled = String(process.env.DEBUG_DATAMAP || '').trim() === '1';
  const dbg = (...args) => {
    if (!debugEnabled) return;
    try {
      console.log('[datamapParser]', ...args);
    } catch {
      // ignore logging failures
    }
  };

  dbg('parseDatamapFromExcelFile()', { filePath });

  if (!workbook?.SheetNames || workbook.SheetNames.length < 2) {
    const err = new Error('No datamap sheet found. File must have at least 2 sheets.');
    err.status = 404;
    err.availableSheets = workbook?.SheetNames || [];
    throw err;
  }

  // Try to find datamap sheet (could be named "Datamap", "Data Map", or be the second sheet)
  const datamapSheetName = workbook.SheetNames.find((name) =>
    String(name || '').toLowerCase().includes('datamap') ||
    String(name || '').toLowerCase().includes('data map') ||
    String(name || '').toLowerCase().includes('data_map')
  ) || workbook.SheetNames[1];

  const datamapWorksheet = workbook.Sheets[datamapSheetName];
  if (!datamapWorksheet) {
    const err = new Error(`Could not find datamap sheet: ${datamapSheetName}`);
    err.status = 404;
    err.availableSheets = workbook.SheetNames;
    throw err;
  }

  // Convert sheet to JSON with raw values to preserve formatting
  const rawData = XLSX.utils.sheet_to_json(datamapWorksheet, {
    defval: '',
    blankrows: false,
    raw: true,
    header: 1,
  });

  if (!rawData || rawData.length === 0) {
    const err = new Error('Datamap sheet is empty');
    err.status = 404;
    err.sheetName = datamapSheetName;
    throw err;
  }

  // Parse the datamap structure
  // Based on the structure: question IDs in brackets, question text, values, response options
  const parsedDatamap = [];
  let currentQuestion = null;

  for (let i = 0; i < rawData.length; i++) {
    const row = rawData[i];
    if (!row || row.length === 0) continue;

    // Convert row to array of strings, handling empty cells
    const rowCells = [];
    for (let j = 0; j < Math.max(row.length || 0, 4); j++) {
      // Use nullish coalescing so numeric 0 isn't treated as empty
      rowCells.push(String(row[j] ?? '').trim());
    }

    const firstCell = rowCells[0];
    const secondCell = rowCells[1] || '';
    const thirdCell = rowCells[2] || '';
    const fourthCell = rowCells[3] || '';

    if (debugEnabled) {
      const fc = String(firstCell || '').toLowerCase();
      if (fc.includes('values: 0-1') || fc.includes('value: 0-1') || fc.match(/values?:\s*0\s*-\s*1/)) {
        dbg('saw values 0-1 row (parsedDatamap loop)', { row: i, firstCell, secondCell, thirdCell, fourthCell });
      }
      // Heuristic: possible question start lines like "hQB2Maskr1: ..." or "QB2: ..."
      if (/^[A-Za-z][A-Za-z0-9_]*:\s*/.test(String(firstCell || '').trim())) {
        dbg('possible question line (parsedDatamap loop)', { row: i, firstCell });
      }
    }

    // Check if this is a question ID (starts with [ and ends with ])
    if (firstCell.match(/^\[.+\]$/)) {
      // Save previous question if exists
      if (currentQuestion) {
        parsedDatamap.push(currentQuestion);
      }

      // Start new question
      // Question text might be in second or third cell
      let questionText = secondCell || thirdCell || '';
      let values = '';
      let purpose = '';

      // Try to identify which cell contains what
      // Values typically look like "1-98", "0-75", "0-100", "0-999", "0-1"
      if (secondCell.match(/^\d+-\d+$/) || secondCell.match(/^\d+$/)) {
        values = secondCell;
        questionText = thirdCell || '';
        purpose = fourthCell || '';
      } else if (thirdCell.match(/^\d+-\d+$/) || thirdCell.match(/^\d+$/)) {
        values = thirdCell;
        purpose = fourthCell || '';
      } else {
        // No clear values pattern, assume question text is in second cell
        questionText = secondCell;
        purpose = thirdCell || fourthCell || '';
      }

      currentQuestion = {
        questionId: firstCell,
        questionText,
        values,
        purpose,
        responseOptions: [],
        categories: [],
      };
      dbg('parsedDatamap new bracketed question', { row: i, questionId: firstCell, values, questionText });
    } else if (currentQuestion) {
      // Check if this is a response option (starts with a number followed by text)
      const optionMatch = firstCell.match(/^(\d+)\s+(.+)$/);
      if (optionMatch) {
        currentQuestion.responseOptions.push({
          code: optionMatch[1],
          label: optionMatch[2].trim(),
        });
        dbg('parsedDatamap response option', { row: i, q: currentQuestion.questionId, code: optionMatch[1], label: optionMatch[2].trim() });
      } else {
        // Check if this is a category (starts with [ and contains category identifier)
        // Categories look like [hQS11Maskc1], [hQS11Ager2], etc.
        const categoryMatch = firstCell.match(/^\[(.+)\]\s*(.+)$/);
        if (categoryMatch) {
          currentQuestion.categories.push({
            id: categoryMatch[1],
            label: categoryMatch[2].trim(),
          });
          dbg('parsedDatamap category', { row: i, q: currentQuestion.questionId, id: categoryMatch[1], label: categoryMatch[2].trim() });
        } else if (firstCell && firstCell.length > 0) {
          // Check if it's a header row (Values, Purpose, etc.) - skip these
          if (!firstCell.match(/^(Values?|Purpose|Question|Category|Options?)/i)) {
            // Might be additional question text or description on continuation rows
            // Only add if we don't already have question text or if it looks like continuation
            if (!currentQuestion.questionText || firstCell.length > 20) {
              if (currentQuestion.questionText && !currentQuestion.questionText.includes(firstCell)) {
                currentQuestion.questionText += ' ' + firstCell;
              } else if (!currentQuestion.questionText) {
                currentQuestion.questionText = firstCell;
              }
            }
          }
        }
      }
    }
  }

  // Don't forget the last question
  if (currentQuestion) {
    parsedDatamap.push(currentQuestion);
  }

  // Extract column definitions from raw data
  // Look for patterns like [columnName]: Description in the first column
  const columnDefinitions = [];

  for (let i = 0; i < rawData.length; i++) {
    const row = rawData[i];
    if (!row || row.length === 0) continue;

    const firstCell = String(row[0] ?? '').trim();

    // Check for multi-select pattern: Text without brackets but with colon (e.g., "QS4: xxx")
    // Next line should have "Value: 0-1" or "Values: 0-1"
    // Make sure the line doesn't start with a bracket
    if (!firstCell.startsWith('[') && firstCell.includes(':')) {
      const multiSelectMatch = firstCell.match(/^([^:\[\]]+):\s*(.*)$/);

      if (multiSelectMatch && i + 1 < rawData.length) {
        const nextRow = rawData[i + 1];
        const nextRowFirstCell = String(nextRow?.[0] ?? '').trim();

        // Check if next row is "Value: 0-1" or "Values: 0-1"
        if (nextRowFirstCell.match(/^values?:\s*0\s*-\s*1$/i)) {
          // Skip the "Value: 0-1" row and the next 2 rows (0-Unchecked, 1-Checked)
          let rowIndex = i + 2; // Start after "Value: 0-1"

          // Skip the 0 and 1 rows if they exist
          let skippedCount = 0;
          while (rowIndex < rawData.length && skippedCount < 2) {
            const checkRow = rawData[rowIndex];
            const code = String(checkRow?.[1] ?? '').trim();
            const codeText = String(checkRow?.[2] ?? '').trim().toLowerCase();

            if ((code === '0' && codeText === 'unchecked') || (code === '1' && codeText === 'checked')) {
              rowIndex++;
              skippedCount++;
            } else {
              break;
            }
          }

          // Now extract the actual column headers from column 2 (in brackets)
          while (rowIndex < rawData.length) {
            const dataRow = rawData[rowIndex];
            if (!dataRow || dataRow.length === 0) {
              break;
            }

            // Check if we've hit another question definition (first column has content with colon or bracket)
            const firstCol = String(dataRow[0] ?? '').trim();
            if (firstCol && (firstCol.includes(':') || firstCol.match(/^\[.+\]/))) {
              break;
            }

            // Look for column headers in column 2 (index 1) with brackets
            const columnHeaderCell = String(dataRow[1] ?? '').trim();
            const columnDescCell = String(dataRow[2] ?? '').trim();

            const headerMatch = columnHeaderCell.match(/^\[([^\]]+)\]$/);
            if (headerMatch && columnDescCell) {
              const columnName = headerMatch[1].trim();
              const description = columnDescCell;

              columnDefinitions.push({
                columnName,
                description,
                nextRowText: 'Values: 0-1',
                responseCodes: [
                  { code: '0', text: 'Unchecked' },
                  { code: '1', text: 'Checked' },
                ],
              });
            } else if (!columnHeaderCell) {
              // Empty column 2, we're done with this multi-select
              break;
            }

            rowIndex++;
          }

          // Skip ahead in the main loop
          i = rowIndex - 1;
          continue;
        }
      }
    }

    // Match pattern: [columnName]: Description
    // Example: [record]: Record number
    const definitionMatch = firstCell.match(/^\[([^\]]+)\]:\s*(.+)$/);
    if (definitionMatch) {
      const columnName = definitionMatch[1].trim();
      const description = definitionMatch[2].trim();
      if (columnName && description) {
        // Get the next row's text (if it exists)
        // This shows: "Open numeric response", "Open text response", or value ranges like "Values: 1-99"
        let nextRowText = '';
        if (i + 1 < rawData.length) {
          const nextRow = rawData[i + 1];
          if (nextRow && nextRow.length > 0) {
            // Get the first cell of the next row
            nextRowText = String(nextRow[0] ?? '').trim();
            // If the next row starts with a bracket, it's probably another column definition, so skip it
            if (nextRowText.match(/^\[.+\]/)) {
              nextRowText = '';
            }
            // Also check if it's a "Values:" line - might be in first or second cell
            if (!nextRowText && nextRow.length > 1) {
              const secondCell = String(nextRow[1] ?? '').trim();
              if (secondCell.toLowerCase().startsWith('values:')) {
                nextRowText = secondCell;
              }
            }
          }
        }

        // Extract response codes
        const isOpenResponse = nextRowText.toLowerCase().includes('open numeric') || nextRowText.toLowerCase().includes('open text');

        const responseCodes = [];
        if (!isOpenResponse && i + 1 < rawData.length) {
          // Start looking from the row after the column definition
          // Look for codes in column 2 (index 1) and text in column 3 (index 2)
          let rowIndex = i + 1;

          // Skip the response type row if it exists (the row with "Values: 1-4" or similar)
          if (nextRowText && !nextRowText.match(/^\[.+\]/)) {
            rowIndex = i + 2;
          }

          // Continue until we hit a blank column 2 or another column definition
          while (rowIndex < rawData.length) {
            const codeRow = rawData[rowIndex];
            if (!codeRow || codeRow.length === 0) {
              break;
            }

            // Check if this is another column definition (starts with [ in column 1)
            const firstCell2 = String(codeRow[0] ?? '').trim();
            if (firstCell2.match(/^\[.+\]/)) {
              break;
            }

            // Get code from column 2 (index 1) and text from column 3 (index 2)
            const code = String(codeRow[1] ?? '').trim();
            const codeText = String(codeRow[2] ?? '').trim();

            // Stop if column 2 is blank
            if (!code) {
              break;
            }

            // Add the code and text (both must exist)
            if (code && codeText) {
              responseCodes.push({ code, text: codeText });
            }

            rowIndex++;
          }
        }

        columnDefinitions.push({
          columnName,
          description,
          nextRowText,
          responseCodes,
        });
      }
    }
  }

  // Extract questions from raw data for debug table
  // Questions are in first column, either "[QS4]: description" or "QS4: description"
  // Response type/value range is in the row AFTER the question
  const parsedQuestions = [];

  for (let i = 0; i < rawData.length; i++) {
    const row = rawData[i];
    if (!row || row.length === 0) continue;

    const firstCell = String(row[0] ?? '').trim();

    if (debugEnabled) {
      const fc = firstCell.toLowerCase();
      if (fc.includes('values: 0-1') || fc.includes('value: 0-1') || fc.match(/values?:\s*0\s*-\s*1/)) {
        dbg('saw values 0-1 row (parsedQuestions loop)', { row: i, firstCell, row });
      }
    }

    // Check for question pattern: [QS4]: description or QS4: description
    let questionMatch = null;
    let questionNumber = '';
    let description = '';

    // Pattern 1: [QS4]: description
    const bracketMatch = firstCell.match(/^\[([^\]]+)\]:\s*(.+)$/);
    if (bracketMatch) {
      questionNumber = bracketMatch[1].trim();
      description = bracketMatch[2].trim();
      questionMatch = bracketMatch;
    } else {
      // Pattern 2: QS4: description (no brackets)
      // Exclude things like "Values:", "Purpose:", etc.
      const noBracketMatch = firstCell.match(/^([A-Za-z0-9]+):\s*(.+)$/);
      if (noBracketMatch) {
        const potentialQNum = noBracketMatch[1].trim();
        if (
          potentialQNum.match(/^[A-Za-z]/) &&
          !potentialQNum.match(/^(Values?|Purpose|Question|Category|Options?|Open|Response)$/i)
        ) {
          questionNumber = potentialQNum;
          description = noBracketMatch[2].trim();
          questionMatch = noBracketMatch;
        }
      }
    }

    if (questionMatch && questionNumber) {
      dbg('parsedQuestions found question', { row: i, questionNumber, firstCell });
      // Get response type/value range from the next row (row AFTER the question)
      let responseType = '';
      let isOpenResponse = false;
      let responseCodes = [];
      let notes = [];

      if (i + 1 < rawData.length) {
        const nextRow = rawData[i + 1];
        if (nextRow && nextRow.length > 0) {
          const nextFirstCell = String(nextRow[0] ?? '').trim();
          const nextSecondCell = String(nextRow[1] ?? '').trim();

          const isNextQuestion =
            nextFirstCell.match(/^\[.+\]:/) ||
            (nextFirstCell.match(/^([A-Za-z0-9]+):/) && !nextFirstCell.match(/^(Values?|Purpose|Question|Category|Options?|Open|Response):/i));

          if (!isNextQuestion) {
            // Use first cell if it has content, otherwise try second cell
            responseType = nextFirstCell || nextSecondCell;

            // Check if this is an open response type
            isOpenResponse =
              responseType.toLowerCase().includes('open numeric') ||
              responseType.toLowerCase().includes('open numeric response') ||
              responseType.toLowerCase().includes('open text') ||
              responseType.toLowerCase().includes('open text response');

            // Clean up and normalize common patterns
            if (responseType.toLowerCase().includes('open numeric') || responseType.toLowerCase().includes('open numeric response')) {
              responseType = 'Open Numeric';
            } else if (responseType.toLowerCase().includes('open text') || responseType.toLowerCase().includes('open text response')) {
              responseType = 'Open Text';
            } else if (responseType.match(/values?:\s*0\s*-\s*1/i)) {
              responseType = 'Values: 0-1';
            } else if (responseType.toLowerCase().startsWith('values:')) {
              responseType = responseType;
            } else if (responseType.match(/^\d+-\d+$/)) {
              responseType = `Values: ${responseType}`;
            } else if (responseType && responseType.length > 0) {
              responseType = responseType;
            } else {
              responseType = 'Unknown';
            }

            // Extract response codes if not an open response
            if (!isOpenResponse) {
              const isValuesType = responseType.toLowerCase().includes('values:') || responseType.match(/values?:\s*\d+/i);

              if (isValuesType) {
                // For all "Values:" types, codes are in column 2, text in column 3
                let rowIndex = i + 2;
                while (rowIndex < rawData.length) {
                  const codeRow = rawData[rowIndex];
                  if (!codeRow || codeRow.length === 0) break;

                  const codeRowFirstCell = String(codeRow[0] ?? '').trim();
                  const codeRowSecondCell = codeRow.length > 1 ? String(codeRow[1] ?? '').trim() : '';
                  const codeRowThirdCell = codeRow.length > 2 ? String(codeRow[2] ?? '').trim() : '';

                  const isAnotherQuestion =
                    codeRowFirstCell &&
                    (codeRowFirstCell.match(/^\[.+\]:/) ||
                      (codeRowFirstCell.match(/^([A-Za-z0-9]+):/) &&
                        !codeRowFirstCell.match(/^(Values?|Purpose|Question|Category|Options?|Open|Response):/i)));
                  if (isAnotherQuestion) break;

                  if (codeRowFirstCell && codeRowFirstCell.match(/^(Values?|Purpose|Question|Category|Options?)/i)) {
                    rowIndex++;
                    continue;
                  }

                  // Values-type code rows can be formatted a few different ways depending on export:
                  // - col2=0, col3=Unchecked
                  // - col1="0 Unchecked"
                  // - col1=0, col2=Unchecked
                  // We try all patterns before falling back to notes.
                  let extracted = null;

                  // Pattern A: numeric code in column 2
                  if (codeRowSecondCell && /^\d+$/.test(codeRowSecondCell)) {
                    extracted = {
                      code: codeRowSecondCell,
                      text: codeRowThirdCell || codeRowFirstCell || codeRowSecondCell,
                    };
                  }

                  // Pattern B: "0 Unchecked" in column 1
                  if (!extracted && codeRowFirstCell) {
                    const m = codeRowFirstCell.match(/^(\d+)\s+(.+)$/);
                    if (m) {
                      extracted = { code: m[1], text: m[2].trim() };
                    }
                  }

                  // Pattern C: code in column 1, label in column 2
                  if (!extracted && codeRowFirstCell && /^\d+$/.test(codeRowFirstCell) && codeRowSecondCell) {
                    extracted = { code: codeRowFirstCell, text: codeRowSecondCell };
                  }

                  if (extracted) {
                    responseCodes.push({
                      code: String(extracted.code).trim(),
                      text: String(extracted.text || extracted.code).trim(),
                    });
                    rowIndex++;
                    continue;
                  }

                  // Anything else (like bracketed [h...] references) is captured as notes.
                  if (codeRowSecondCell) {
                    const noteBits = [codeRowFirstCell, codeRowSecondCell, codeRowThirdCell].filter(Boolean);
                    if (noteBits.length > 0) notes.push(noteBits.join(' ').trim());
                    rowIndex++;
                    continue;
                  }

                  if (!codeRowSecondCell && !codeRowThirdCell) break;

                  // Non-empty content without a code: treat as notes
                  if (codeRowFirstCell) {
                    notes.push(codeRowFirstCell);
                  }
                  rowIndex++;
                }
              } else {
                // For other types, try first column pattern "1 Option text"
                let rowIndex = i + 2;
                while (rowIndex < rawData.length) {
                  const codeRow = rawData[rowIndex];
                  if (!codeRow || codeRow.length === 0) break;
                  const codeRowFirstCell = String(codeRow[0] ?? '').trim();

                  const isAnotherQuestion =
                    codeRowFirstCell.match(/^\[.+\]:/) ||
                    (codeRowFirstCell.match(/^([A-Za-z0-9]+):/) &&
                      !codeRowFirstCell.match(/^(Values?|Purpose|Question|Category|Options?|Open|Response):/i));
                  if (isAnotherQuestion) break;

                  if (codeRowFirstCell.match(/^(Values?|Purpose|Question|Category|Options?)/i)) {
                    rowIndex++;
                    continue;
                  }

                  const optionMatch = codeRowFirstCell.match(/^(\d+)\s+(.+)$/);
                  if (optionMatch) {
                    responseCodes.push({ code: optionMatch[1], text: optionMatch[2].trim() });
                    rowIndex++;
                    continue;
                  }

                  if (!codeRowFirstCell) break;
                  // If it's not a numeric option line, keep it as notes for debugging.
                  if (codeRowFirstCell && !codeRowFirstCell.match(/^(Values?|Purpose|Question|Category|Options?)/i)) {
                    notes.push(codeRowFirstCell);
                  }
                  rowIndex++;
                }
              }
            }
          }
        }
      }

      dbg('parsedQuestions extracted', {
        questionNumber,
        responseType,
        responseCodesCount: Array.isArray(responseCodes) ? responseCodes.length : 0,
        notesCount: Array.isArray(notes) ? notes.length : 0,
      });

      // Only add if we haven't seen this question number yet (to avoid duplicates)
      const existingQuestion = parsedQuestions.find((q) => q.questionNumber === questionNumber);
      if (!existingQuestion) {
        // Try to get response codes from parsedDatamap if we didn't find any
        let matchedResponseCodes = responseCodes;
        if (responseCodes.length === 0 && parsedDatamap.length > 0) {
          const cleanQuestionNumber = questionNumber.replace(/^\[|\]$/g, '').replace(/^Q/, '');
          const matchingQuestion = parsedDatamap.find((q) => {
            const qId = q.questionId || '';
            const cleanQId = qId.replace(/^\[|\]$/g, '').replace(/^Q/, '');
            return (
              cleanQId === cleanQuestionNumber ||
              qId === questionNumber ||
              qId === `[${questionNumber}]` ||
              qId === `Q${questionNumber}`
            );
          });

          if (matchingQuestion?.responseOptions?.length > 0) {
            matchedResponseCodes = matchingQuestion.responseOptions.map((opt) => ({
              code: opt.code,
              text: opt.label || opt.text || '',
            }));
          }
        }

        // Check if this is the first question (respondent ID)
        const isFirstQuestion = parsedQuestions.length === 0;
        const finalResponseType = isFirstQuestion ? 'ID' : (responseType || 'Unknown');

        parsedQuestions.push({
          questionNumber,
          description,
          responseType: finalResponseType,
          responseCodes: matchedResponseCodes,
          isOpenResponse,
          notes: Array.from(new Set((notes || []).map((n) => String(n || '').trim()).filter(Boolean))),
        });
      }
    }
  }

  dbg('parseDatamapFromExcelFile() done', {
    sheetName: datamapSheetName,
    parsedQuestions: parsedQuestions.length,
    parsedDatamap: parsedDatamap.length,
    columnDefinitions: columnDefinitions.length,
  });

  if (parsedDatamap.length === 0) {
    return {
      sheetName: datamapSheetName,
      questions: [],
      totalQuestions: 0,
      columnDefinitions,
      parsedQuestions,
      rawData: rawData.slice(0, rawDataPreviewRowsOnFailure),
      warning: 'Could not parse datamap structure. Raw data included for debugging.',
      availableSheets: workbook.SheetNames,
    };
  }

  return {
    sheetName: datamapSheetName,
    questions: parsedDatamap,
    totalQuestions: parsedDatamap.length,
    columnDefinitions,
    parsedQuestions,
    rawData: rawData.slice(0, rawDataPreviewRows),
    availableSheets: workbook.SheetNames,
  };
}





