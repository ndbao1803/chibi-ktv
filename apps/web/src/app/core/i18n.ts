import { Pipe, PipeTransform, signal } from '@angular/core';

/**
 * N-08: Vietnamese first, English on request. A small dictionary keyed by the Vietnamese text,
 * so templates stay readable: `{{ 'Thêm bài' | t }}`. Room messages from the server stay
 * Vietnamese. Missing entries simply show the Vietnamese text.
 */
export type Lang = 'vi' | 'en';
const KEY = 'ktv.lang';

function readLang(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'vi' || v === 'en') return v;
  } catch {
    /* storage blocked */
  }
  return 'vi';
}

export const lang = signal<Lang>(readLang());
document.documentElement.lang = lang();

export function setLang(l: Lang) {
  lang.set(l);
  document.documentElement.lang = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* not remembered */
  }
}

const EN: Record<string, string> = {
  'Xin chào,': 'Hi,',
  'Đăng xuất': 'Log out',
  'Tạo phòng mới': 'New room',
  'Tên phòng': 'Room name',
  'Số ghế': 'Seats',
  '8 người': '8 people',
  '16 người': '16 people',
  'Tạo phòng': 'Create room',
  'Vào phòng bạn bè': "Join a friend's room",
  'Mã phòng (6 ký tự)': 'Room code (6 characters)',
  'Vào phòng': 'Enter',
  'VD: K7M2QX': 'e.g. K7M2QX',
  'Phòng karaoke 3D cho hội bạn thân': 'A 3D karaoke room for your friends',
  'Đăng nhập': 'Log in',
  'Tạo tài khoản': 'Sign up',
  'Tên hiển thị trong phòng': 'Name shown in the room',
  'Mật khẩu': 'Password',
  'Ít nhất 8 ký tự': 'At least 8 characters',
  'Ví dụ: Minh Anh': 'e.g. Minh Anh',
  'Quyền riêng tư': 'Privacy',
  '💬 Trò chuyện': '💬 Chat',
  'Trò chuyện': 'Chat',
  'Bạn đang hát — đọc tin nhắn sau nhé 🎤': "You're singing — read the chat later 🎤",
  '＋ Thêm vào hàng chờ': '＋ Add to queue',
  'Chưa có tin nhắn. Chào cả phòng đi!': 'No messages yet. Say hi!',
  'Tin nhắn': 'Message',
  'Gửi': 'Send',
  'tin chưa đọc': 'unread',
  'Nhắn cả phòng… (@tên, /me, /hat link, /skip)': 'Message the room… (@name, /me, /hat link, /skip)',
  '📱 Lắc máy': '📱 Shake phone',
  '🌸 Tặng hoa': '🌸 Throw a flower',
  '🥂 Cụng ly': '🥂 Cheers!',
  '💨 Xì hơi': '💨 Fart',
  'Quẩy': 'Party',
  'Đạo cụ': 'Props',
  'Giữ để lắc (hoặc giữ phím Space)': 'Hold to shake (or hold Space)',
  'Lắc điện thoại để lắc đạo cụ': 'Shake your phone to shake the prop',
  'Ném hoa lên sân khấu': 'Throw a flower onto the stage',
  '1, 2, 3, DÔ! — cả phòng cụng ly': '1, 2, 3, DÔ! — the whole room clinks glasses',
  'Trò đùa: 2 phút một lần': 'A prank: once every 2 minutes',
  'Mở trên 2 máy cạnh nhau: tiếng click phải vang cùng lúc.': 'Open on two devices side by side: the clicks should sound together.',
  'Chưa có bài — dán link YouTube vào “Danh sách bài” để thêm, hoặc bấm “Nhạc thử nhịp”.': 'No song yet — paste a YouTube link in “Danh sách bài”, or press “Nhạc thử nhịp”.',
  'Âm lượng nhạc': 'Music volume',
  'Danh sách bài': 'Song queue',
  'Đang phát': 'Now playing',
  'Chưa có bài — dán link YouTube để thêm vào danh sách.': 'No song yet — paste a YouTube link to add one.',
  'Huỷ mời': 'Cancel invite',
  'Link YouTube': 'YouTube link',
  'Thêm bài': 'Add song',
  'Hát một mình': 'Sing alone',
  'Mời song ca': 'Invite to duet',
  'Chọn người…': 'Choose someone…',
  'Không nhận lời mời song ca': 'No duet invites',
  'Dán link YouTube karaoke…': 'Paste a YouTube karaoke link…',
  'Ai hát': 'Who sings',
  'Mời ai': 'Invite who',
  '🎤 đang hát': '🎤 singing',
  '🎤 song ca': '🎤 duet',
  'Rời phòng': 'Leave',
  'Chép link mời': 'Copy invite link',
  'Đã chép link': 'Link copied',
  'Cả phòng': 'Room',
  'Sân khấu': 'Stage',
  'Chỗ tôi': 'My seat',
  'Tiết kiệm pin': 'Battery saver',
  'Bấm vào ghế trống để đổi chỗ': 'Click a free seat to move',
  'Nhạc thử nhịp': 'Test beat',
  'Mic mở': 'Open mic',
  '📣 Hú hét': '📣 Cheer',
  'Tắt tiếng khán giả': 'Mute the audience',
  'Khán giả khi hát': 'Audience during songs',
  'Giữ bài': 'Keep the song',
  '🎤 Bật micro': '🎤 Turn mic on',
  'Xuống sân khấu': 'Leave the stage',
  'Đến lượt bạn hát!': 'Your turn to sing!',
  'Không mở được micro — bấm để thử lại': "Mic didn't open — tap to retry",
  'Đang mở micro…': 'Opening the mic…',
  'Bỏ lượt': 'Skip my turn',
  'Giọng trễ hơn nhạc? Kéo sang phải': 'Voice behind the music? Drag right',
  'Về 0': 'Reset',
  '🎤 Lên hát': '🎤 Sing',
  'Mất kết nối': 'Connection lost',
  '— đang thử kết nối lại… Nhạc vẫn chạy; ghế và bài của bạn được giữ 20 giây.':
    '— reconnecting… The music keeps playing; your seat and songs are kept for 20 seconds.',
  'Bấm để nghe ca sĩ': 'Tap to hear the singer',
  'Trình duyệt chặn âm thanh tự động phát': 'The browser blocked sound until you tap',
  'Đồng ý': 'Yes',
  'Bạn đang dùng tai nghe gì?': 'Which headphones are you using?',
  'Đã thêm bài! Trả lời một lần để tới lượt bạn, micro tự bật mà không cần bấm thêm.':
    'Song added! Answer once, and your mic turns on by itself when your turn comes.',
  'Nên dùng tai nghe có dây.': 'Wired earphones work best.',
  'Có, tai nghe có dây': 'Yes, wired earphones',
  'Tai nghe Bluetooth': 'Bluetooth headphones',
  'Không có tai nghe': 'No headphones',
  'Bấm để bật âm thanh': 'Tap to turn sound on',
  'Về sảnh': 'Back to the lobby',
  'Đang online': 'Online',
  'đang nói': 'talking',
  'Góc nhìn': 'View',
  'Tắt đèn nháy, bóng bay và giảm độ nét để máy chạy mượt hơn': 'Turns off flashing lights and balloons and lowers the resolution, so it runs smoother',
  'Độ sôi động': 'Hype',
  'Giữ để nói (hoặc giữ phím V)': 'Hold to talk (or hold V)',
  'Mic luôn bật, tự tắt khi bạn im lặng': 'Mic always on, quiet when you are',
  'Âm lượng micro': 'Mic level',
  '🏆 Bảng điểm': '🏆 Scores',
  'Bảng điểm đêm nay': "Tonight's scores",
  'Ca sĩ của đêm:': 'Singer of the night:',
  'Chấm điểm': 'Rate',
  'Số sao': 'Stars',
  'Phòng karaoke 3D với các nhân vật chibi': 'A 3D karaoke room with chibi characters',
  'Huỷ': 'Cancel',
  'Để sau': 'Later',
  'Từ chối': 'No',
  'Sôi động': 'Hype',
  'Quẩy hết cỡ! 🎉': 'Party time! 🎉',
  'Sắp nổ rồi, lắc tiếp!': 'Almost there, keep shaking!',
  'Đang lắc!': 'Shaking!',
  'Giữ để lắc (Space)': 'Hold to shake (Space)',
  'Đang nói…': 'Talking…',
  'Giữ để nói (V)': 'Hold to talk (V)',
  'Bỏ qua bài này': 'Skip this song',
  'Rút phiếu bỏ qua': 'Take back skip vote',
  'Tiếng vọng': 'Echo',
  'Tắt': 'Off',
  'Nhẹ': 'Light',
  'Vừa': 'Medium',
};

/** `{{ 'Thêm bài' | t }}` → "Add song" in English. Not pure: it re-reads the language signal. */
@Pipe({ name: 't', pure: false })
export class TranslatePipe implements PipeTransform {
  transform(vi: string): string {
    return lang() === 'en' ? (EN[vi] ?? vi) : vi;
  }
}
