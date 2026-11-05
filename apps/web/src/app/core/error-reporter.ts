import { ErrorHandler, Injectable } from '@angular/core';

/**
 * O-01: sends unexpected browser errors to our own server log (free, no third-party service).
 * Only the error text, the page path and the browser name go out: never chat, names or audio.
 * At most 5 reports per page visit.
 */
@Injectable()
export class ReportingErrorHandler implements ErrorHandler {
  private sent = 0;

  handleError(error: unknown): void {
    console.error(error);
    if (this.sent >= 5) return;
    this.sent++;
    const e = error instanceof Error ? error : new Error(String(error));
    const body = JSON.stringify({
      message: e.message.slice(0, 500),
      stack: e.stack?.slice(0, 3000),
      url: location.pathname.slice(0, 300),
      ua: navigator.userAgent.slice(0, 300),
    });
    // sendBeacon survives the page closing; fetch is the fallback.
    if (!navigator.sendBeacon?.('/api/client-errors', new Blob([body], { type: 'application/json' }))) {
      void fetch('/api/client-errors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
    }
  }
}
