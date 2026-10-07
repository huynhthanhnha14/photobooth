(function () {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.APP_CONFIG;

  if (!SUPABASE_URL || SUPABASE_URL.includes('your-project')) {
    alert(
      '⚠️ Bạn chưa cấu hình Supabase!\n\n' +
      'Mở file js/config.js và điền SUPABASE_URL + SUPABASE_ANON_KEY.'
    );
  }

  window.supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
  );
})();