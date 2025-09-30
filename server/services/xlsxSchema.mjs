export const sheetOrder = [
  "Demos",
  "Background & SMA Management",
  "Category Ranking",
  "Category C",
  "Category S",
  "Dashboard"
];

// Define the canonical column order for each sheet based on your template.
export function buildSchema(sheetName) {
  switch (sheetName) {
    case "Demos":
      return ["ID","Attribute","Value","Notes"];
    case "Background & SMA Management":
      return ["Theme","Subtheme","Item","Definition","Example","Mentions","Positive","Neutral","Negative","Rank","Notes",
              "c01","c02","c03","c04","c05","c06","c07","c08","c09","c10","c11","c12","c13","c14","c15","c16"];
    case "Category Ranking":
      return ["Category","Statement","Mentions","Top Box","Second Box","Bottom Box","Net Positive","Rank","Notes",
              "s01","s02","s03","s04","s05","s06","s07","s08","s09","s10"];
    case "Category C":
      return defaultLongCategory();
    case "Category S":
      return defaultLongCategory();
    case "Dashboard":
      return ["Metric","Value","Delta","Notes","Last Updated","Owner","Flag"];
    default:
      return ["Item","Mentions","Rank","Notes"];
  }
}

function defaultLongCategory() {
  // Generic wide sheet: statement rows + per-respondent coding columns
  const base = ["Statement ID","Headline","Subhead","Theme","Subtheme","Mentions","Top Box","Second Box","Bottom Box","Net Positive","Believability","Differentiation","Motivation","Clarity","Rank","Notes"];
  const respondents = Array.from({length: 30}, (_,i) => `r${i+1}`);
  return [...base, ...respondents];
}