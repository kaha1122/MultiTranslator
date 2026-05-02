export const CAT_THEME = {
    daily:     { base: '#10b981', dark: '#0e9f73' },
    travel:    { base: '#3b82f6', dark: '#2563eb' },
    business:  { base: '#f59e0b', dark: '#d97706' },
    education: { base: '#8b5cf6', dark: '#7c3aed' },
    social:    { base: '#ec4899', dark: '#db2777' },
    tech:      { base: '#06b6d4', dark: '#0891b2' },
    culture:   { base: '#f97316', dark: '#ea580c' },
};

export const getCatTheme = (catId) =>
    CAT_THEME[catId] || { base: '#94a3b8', dark: '#64748b' };
