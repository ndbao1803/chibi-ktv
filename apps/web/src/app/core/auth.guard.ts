import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/** Pages that need a login: send guests to /login and come back afterwards. */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  return auth.loggedIn() ? true : inject(Router).createUrlTree(['/login'], { queryParams: { next: state.url } });
};

/** The login page itself: logged-in users skip it. */
export const guestGuard: CanActivateFn = () =>
  inject(AuthService).loggedIn() ? inject(Router).createUrlTree(['/lobby']) : true;
