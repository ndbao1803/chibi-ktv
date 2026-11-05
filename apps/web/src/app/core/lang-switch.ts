import { Component } from '@angular/core';
import { lang, setLang } from './i18n';

/** VI | EN (N-08). Remembered in this browser. */
@Component({
  selector: 'app-lang-switch',
  template: `
    <span class="lang" role="group" aria-label="Ngôn ngữ / Language">
      <button [attr.aria-pressed]="lang() === 'vi'" (click)="setLang('vi')">VI</button>
      <button [attr.aria-pressed]="lang() === 'en'" (click)="setLang('en')">EN</button>
    </span>
  `,
  styles: `
    .lang { display: inline-flex; border: 1px solid var(--line); border-radius: 999px; overflow: hidden; }
    button { background: none; border: 0; padding: 3px 8px; font-size: 11px; color: var(--muted); }
    button[aria-pressed='true'] { background: rgba(51, 225, 237, 0.15); color: var(--fg); }
  `,
})
export class LangSwitch {
  protected readonly lang = lang;
  protected readonly setLang = setLang;
}
