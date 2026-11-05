import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/** P-07: what Chibi KTV keeps about you, in plain words. */
@Component({
  selector: 'app-privacy-page',
  imports: [RouterLink],
  template: `
    <main class="panel doc">
      <a routerLink="/lobby" class="back">← Về sảnh</a>
      <h1>Quyền riêng tư</h1>
      <p class="lead">Chibi KTV là một ứng dụng nhỏ, miễn phí, làm để hát cùng bạn bè. Đây là tất cả những gì nó lưu.</p>

      <h2>Được lưu trên máy chủ</h2>
      <ul>
        <li><b>Tài khoản:</b> email, tên hiển thị, và mật khẩu đã được mã hoá một chiều (argon2) — không ai đọc được mật khẩu gốc.</li>
        <li><b>Phòng:</b> tên phòng, mã phòng, số ghế, ai tạo phòng.</li>
        <li><b>Báo lỗi:</b> khi trang bị lỗi, trình duyệt gửi nội dung lỗi, đường dẫn trang và tên trình duyệt vào nhật ký máy chủ để sửa lỗi. Không kèm tên, tin nhắn hay âm thanh.</li>
      </ul>

      <h2>Không bao giờ được lưu</h2>
      <ul>
        <li><b>Giọng nói:</b> đi thẳng từ máy bạn tới máy bạn bè (kết nối ngang hàng). Máy chủ không nghe, không ghi âm.</li>
        <li><b>Tin nhắn, hàng chờ, điểm số:</b> chỉ nằm trong bộ nhớ khi phòng đang mở, mất khi phòng đóng.</li>
      </ul>

      <h2>Cookie</h2>
      <p>Một cookie đăng nhập (<code>ktv_token</code>), chỉ để nhớ bạn đã đăng nhập. Trình phát YouTube có cookie riêng của YouTube, theo
        <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">chính sách của Google</a>.</p>

      <h2>Trình duyệt của bạn</h2>
      <p>Một vài lựa chọn được nhớ ngay trên máy bạn (âm lượng khán giả, độ trễ giọng, tiết kiệm pin, khung chat) và không gửi đi đâu.</p>

      <h2>Xoá tài khoản</h2>
      <p>Nhắn cho người quản lý phòng hát (Bảo) để xoá tài khoản và mọi phòng bạn đã tạo.</p>
    </main>
  `,
  styles: `
    :host { display: block; padding: 24px max(16px, env(safe-area-inset-left, 0px)); }
    .doc { max-width: 680px; margin: 0 auto; padding: 24px; line-height: 1.6; }
    h1 { margin: 8px 0 4px; font-size: 26px; }
    h2 { margin: 20px 0 6px; font-size: 16px; color: var(--cyan); }
    .lead { color: var(--muted); margin: 0 0 8px; }
    ul { margin: 0; padding-left: 20px; display: grid; gap: 6px; }
    .back { color: var(--muted); font-size: 13px; }
    a { color: var(--cyan); }
    code { color: var(--gold); }
  `,
})
export class PrivacyPage {}
