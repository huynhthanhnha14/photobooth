// ============================================
// CẤU HÌNH SUPABASE
// Điền thông tin project của bạn vào đây
// ============================================
window.APP_CONFIG = {
  // Lấy tại: Supabase Dashboard → Settings → API
  SUPABASE_URL: 'https://jbshiitgjmmlbayjomzq.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_Pb5wAXUioOAjkxFCxFZvcg_r_hQl7cZ',

  // Tên bucket lưu ảnh (tạo trong Supabase Storage)
 // 2 bucket lưu ảnh
  STORAGE_BUCKET_COMBINED: 'photos',              // Ảnh tổng hợp (có khung)
  STORAGE_BUCKET_INDIVIDUAL: 'photos-individual', // Ảnh gốc từng tấm

  // Số giây đếm ngược mỗi tấm
  COUNTDOWN_SECONDS: 5,
};