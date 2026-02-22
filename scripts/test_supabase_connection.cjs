const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://jzwhcoivwzumqrfscnlw.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp6d2hjb2l2d3p1bXFyZnNjbmx3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1ODcxOTAsImV4cCI6MjA4NzE2MzE5MH0.B43gsM5l0bQNxtMOPUbPu8lrl87QBGPgrTPm66fdewI';

console.log('Testing Supabase Connection...');
console.log(`URL: ${SUPABASE_URL}`);
console.log(`Key: ${SUPABASE_KEY.substring(0, 10)}...`);

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function testConnection() {
  try {
    // Try to select from 'vehicles' table, limit 1
    const { data, error } = await supabase.from('vehicles').select('*').limit(1);

    if (error) {
      console.error('❌ Connection Failed!');
      console.error('Error:', error.message);
      if (error.code) console.error('Code:', error.code);
      if (error.details) console.error('Details:', error.details);
    } else {
      console.log('✅ Connection Successful!');
      console.log('Data retrieved:', data);
    }
  } catch (err) {
    console.error('❌ Unexpected Error:', err.message);
  }
}

testConnection();
