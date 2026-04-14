import { createClient } from "@supabase/supabase-js";

const url = process.env.REACT_APP_SUPABASE_URL;
const key = process.env.REACT_APP_SUPABASE_ANON_KEY;

if (!url || !key) {
  // Loud warning in dev so it's obvious the env isn't set
  // (in production this would mean a misconfigured deploy)

  console.error(
    "Supabase env vars are missing. " +
      "Add REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY to your .env file, " +
      "then restart `npm start`."
  );
}

export const supabase = createClient(url ?? "", key ?? "");
