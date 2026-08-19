/** סביבת הבנייה שמוצגת למשתמשים כדי למנוע עבודה בטעות בסביבת בדיקות. */
export const isTestEnvironment = import.meta.env.VITE_APP_ENV === "TEST";