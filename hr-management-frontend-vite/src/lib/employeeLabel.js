// Picker label for an employee: "Name (EMP1001)", or just the name when the
// record has no employee code (legacy rows), so lists never show "Name ()".
export const employeeLabel = (name, code) => {
  const label = name || 'Unnamed employee';
  return code ? `${label} (${code})` : label;
};
