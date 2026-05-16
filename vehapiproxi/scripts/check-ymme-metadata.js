import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  const { data, error } = await supabase.from('vehicle_metadata')
    .select('data')
    .eq('path', '/year/2011/make/Honda/models')
    .single();
    
  if (error) {
    console.error(error);
    return;
  }
  
  if (data) {
    console.log(JSON.stringify(data.data, null, 2));
  }
}
check();