/** The ways an event can receive its contacts. Safe for client code. */
export const DATA_SOURCES = [
  { id: "sheet", label: "A live Google Sheet", hint: "New rows are added to the dashboard on a schedule." },
  { id: "form", label: "A form on your website", hint: "Your form posts to a secret address and registrations land here straight away." },
  { id: "supabase", label: "A Supabase table", hint: "The dashboard reads a table from your Supabase project on a schedule." },
  { id: "manual", label: "I'll add them myself", hint: "Upload a CSV file or add people one at a time." },
] as const;
export type DataSourceId = (typeof DATA_SOURCES)[number]["id"];
export const isDataSource = (v: unknown): v is DataSourceId => DATA_SOURCES.some((s) => s.id === v);
