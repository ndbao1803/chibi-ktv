import { ApplicationConfig, ErrorHandler, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';
import { AuthService } from './core/auth.service';
import { ReportingErrorHandler } from './core/error-reporter';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: ErrorHandler, useClass: ReportingErrorHandler }, // O-01
    provideHttpClient(withFetch()),
    provideRouter(routes, withComponentInputBinding()),
    // Ask the server "who am I?" once before the first page shows.
    provideAppInitializer(() => inject(AuthService).loadSession()),
  ],
};
