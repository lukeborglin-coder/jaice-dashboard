import { buildCategorySheet } from './server/services/categorySheetBuilder.service.mjs';

const testCategory = {
  category: 'C',
  categoryName: 'Consistent, daily treatment',
  messages: [
    { label: 'C-W', headline: 'No waning, no wondering' },
    { label: 'C-S', headline: 'Sustained impact' },
    { label: 'C-D', headline: 'Consistent impact' },
    { label: 'C-M', headline: 'Increase SMN protein' }
  ]
};

const sheet = buildCategorySheet(testCategory);

console.log('Row 1:', JSON.stringify(sheet[0].slice(0, 20)));
console.log('Row 2:', JSON.stringify(sheet[1].slice(0, 20)));
console.log('Row 3:', JSON.stringify(sheet[2].slice(0, 20)));
