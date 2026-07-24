import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured = Boolean(url && publishableKey);

// The fallback keeps the configuration screen renderable when a local .env file
// has not been created yet. It is never used for a real request.
export const supabase = createClient(
  url || "https://ledgerly-unconfigured.supabase.co",
  publishableKey || "unconfigured",
);
