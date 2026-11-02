import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'lobby' },
  { path: 'login', canActivate: [guestGuard], loadComponent: () => import('./pages/login/login.page').then((m) => m.LoginPage) },
  { path: 'lobby', canActivate: [authGuard], loadComponent: () => import('./pages/lobby/lobby.page').then((m) => m.LobbyPage) },
  // The 3D room is lazy-loaded so Three.js only downloads when you enter a room.
  { path: 'room/:code', canActivate: [authGuard], loadComponent: () => import('./pages/room/room.page').then((m) => m.RoomPage) },
  { path: '**', redirectTo: 'lobby' },
];
