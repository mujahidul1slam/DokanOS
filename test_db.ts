import { createClient } from "npm:@supabase/supabase-js";

const supabaseUrl = Deno.args[0];
const supabaseKey = Deno.args[1];
const supabase = createClient(supabaseUrl, supabaseKey);

const { data, error } = await supabase.from('pathao_integrations').select('*');
if (error) console.error(error);
console.log(JSON.stringify(data, null, 2));
