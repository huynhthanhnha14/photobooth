# 📸 Photobooth Static

Ứng dụng photobooth thuần HTML/CSS/JS — không cần Node.js, không cần build.

## 🚀 Chạy lần đầu

### 1. Tạo Supabase project
1. Vào https://supabase.com → tạo project miễn phí.
2. Vào **SQL Editor** → paste toàn bộ nội dung `supabase-setup.sql` → **Run**.
3. Vào **Settings → API**, copy 2 giá trị:
   - **Project URL** → `SUPABASE_URL`
   - **anon public** key → `SUPABASE_ANON_KEY`

### 2. Cấu hình
Mở `js/config.js` và điền 2 giá trị vừa copy:

```js
SUPABASE_URL: 'https://xxxxx.supabase.co',
SUPABASE_ANON_KEY: 'eyJhbGciOi...',
```

### 3. Chạy thử
Camera API yêu cầu **HTTPS hoặc localhost**, không chạy được khi mở trực tiếp `file://`.

**Cách 1 - VS Code (khuyến nghị):**
- Cài extension **Live Server** → chuột phải `index.html` → **Open with Live Server**

**Cách 2 - Python:**
```bash
python -m http.server 8000
# Mở http://localhost:8000
```

**Cách 3 - Node (nếu có):**
```bash
npx serve
```

## 📖 Sử dụng
1. Mở `admin.html` để **thêm khung** (URL ảnh PNG nền trong suốt) và **hashtag**.
2. Mở `index.html`, chọn khung → chụp 4 tấm → chọn hashtag → nhận QR.

## ☁️ Hosting miễn phí (tất cả đều kéo thả thư mục vào)
- **Netlify**: https://app.netlify.com/drop
- **Vercel**: https://vercel.com/new
- **GitHub Pages**: push lên repo → Settings → Pages → Deploy from branch
- **Cloudflare Pages**: https://pages.cloudflare.com

## ⚠️ Lưu ý bảo mật
Vì dùng **anon key** ở phía client, ai cũng có thể:
- Đọc/ghi/xóa `frames`, `hashtags`
- Upload ảnh lên bucket `photos`

Với photobooth nội bộ thì chấp nhận được. Nếu muốn bảo mật hơn, cần thêm **Supabase Auth** hoặc **Edge Functions**.

## 💰 Chi phí
- Supabase free: 500MB database + 1GB storage + 5GB băng thông/tháng.
- QR code: GoQR API miễn phí vô hạn.
- Hosting: miễn phí (Netlify/Vercel/GitHub Pages).