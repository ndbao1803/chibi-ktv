import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import type { Namespace } from 'socket.io';
import { Events } from '@ktv/shared';
import { RoomState, type Effects } from './room-state.js';

export const channel = (code: string) => `room:${code}`;
/** An empty room keeps its song and state this long, so a refresh does not reset the night (R-10). */
const EMPTY_ROOM_TTL_MS = 30 * 60_000;
/** Every server-side deadline (song end, away grace, vote re-counts) is driven by one tick per live room. */
const TICK_MS = 1000;

/**
 * Owns every room's live `RoomState`, the 1 s tick that drives it, the empty-room TTL, and the
 * broadcasts out of it. The gateway stays a thin validate → delegate → ack layer (see phase 02 plan).
 */
@Injectable()
export class RoomLiveService implements OnModuleDestroy {
  private readonly log = new Logger(RoomLiveService.name);
  private readonly live = new Map<string, RoomState>();
  private readonly cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly tickTimers = new Map<string, ReturnType<typeof setInterval>>();
  private ns!: Namespace;

  /** Called once from the gateway's `afterInit`, so this service can broadcast without owning the socket. */
  attach(ns: Namespace) {
    this.ns = ns;
  }

  get(code: string): RoomState | undefined {
    return this.live.get(code);
  }

  /** Returns the room's live state, creating it (and its tick) on first use and cancelling any pending cleanup. */
  stateFor(code: string): RoomState {
    clearTimeout(this.cleanupTimers.get(code));
    this.cleanupTimers.delete(code);
    let state = this.live.get(code);
    if (!state) {
      state = new RoomState(code);
      this.live.set(code, state);
      this.startTick(code, state);
    }
    return state;
  }

  /** Call after a room becomes empty: it keeps its state for the TTL, then is dropped for good (R-10). */
  scheduleCleanupIfEmpty(code: string) {
    const state = this.live.get(code);
    if (!state?.isEmpty) return;
    this.cleanupTimers.set(
      code,
      setTimeout(() => {
        this.cleanupTimers.delete(code);
        if (!this.live.get(code)?.isEmpty) return;
        this.live.delete(code);
        clearInterval(this.tickTimers.get(code));
        this.tickTimers.delete(code);
      }, EMPTY_ROOM_TTL_MS).unref(),
    );
  }

  private startTick(code: string, state: RoomState) {
    const timer = setInterval(() => {
      this.apply(state, state.tick(Date.now()));
      // The empty-room TTL only starts once even the away members are gone (R-10).
      if (state.isEmpty && !this.cleanupTimers.has(code)) this.scheduleCleanupIfEmpty(code);
    }, TICK_MS).unref();
    this.tickTimers.set(code, timer);
  }

  /** Broadcasts exactly the pieces an `Effects` says changed. */
  apply(state: RoomState, effects: Effects) {
    if (effects.presence) this.emitPresence(state);
    if (effects.playback) this.emitPlayback(state);
    if (effects.stage) this.emitStage(state);
    if (effects.queue) this.emitQueue(state);
    if (effects.skip) this.emitSkip(state);
    if (effects.notice) this.emitNotice(state, effects.notice);
    for (const t of effects.tell ?? []) this.toUser(state, t.userId, 'room:notice', t.text);
    if (effects.invite) this.toUser(state, effects.invite.toId, Events.duetInvite, effects.invite.invite);
    if (effects.fx) this.ns.to(channel(state.code)).emit(Events.fx, effects.fx);
  }

  /** Every open tab of one member. */
  private toUser(s: RoomState, userId: string, event: string, payload: unknown) {
    for (const id of s.socketsOf(userId)) this.ns.to(id).emit(event, payload);
  }

  emitPresence(s: RoomState) {
    this.ns.to(channel(s.code)).emit(Events.roomPresence, s.presence());
  }
  emitPlayback(s: RoomState) {
    this.ns.to(channel(s.code)).emit(Events.playState, s.playback);
  }
  emitStage(s: RoomState) {
    this.ns.to(channel(s.code)).emit(Events.stageState, s.stage);
  }
  emitQueue(s: RoomState) {
    this.ns.to(channel(s.code)).emit(Events.queueState, s.queue.state());
  }
  emitSkip(s: RoomState) {
    this.ns.to(channel(s.code)).emit(Events.skipState, s.skipState());
  }
  emitNotice(s: RoomState, message: string) {
    this.ns.to(channel(s.code)).emit('room:notice', message);
  }

  /** Frees every room's tick interval on shutdown, so a restart (or a test run) exits cleanly. */
  onModuleDestroy() {
    for (const timer of this.tickTimers.values()) clearInterval(timer);
    this.tickTimers.clear();
    for (const timer of this.cleanupTimers.values()) clearTimeout(timer);
    this.cleanupTimers.clear();
  }
}
