export const environment = {
    production: false,
    apiUrl: '/api',
    features: {
        /** L2 semantic search panel on vehicle dashboard (dev on; prod off until QA). */
        l2Search: true
    },
    supabase: {
        url: 'https://jzwhcoivwzumqrfscnlw.supabase.co',
        anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp6d2hjb2l2d3p1bXFyZnNjbmx3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1ODcxOTAsImV4cCI6MjA4NzE2MzE5MH0.B43gsM5l0bQNxtMOPUbPu8lrl87QBGPgrTPm66fdewI'
    }
};
