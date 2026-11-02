import { HttpErrorResponse } from '@angular/common/http';

/** Turns a server error into one sentence to show the user. */
export function apiError(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) return 'Không kết nối được máy chủ. Thử lại sau ít phút.';
    const m = err.error?.message;
    if (typeof m === 'string') return m;
    if (err.status === 429) return 'Thử quá nhiều lần. Đợi một phút rồi thử lại.';
  }
  return 'Có lỗi xảy ra. Thử lại nhé.';
}
