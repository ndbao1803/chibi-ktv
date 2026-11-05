import { randomUUID } from 'node:crypto';
import {
  MAX_QUEUE_PER_USER,
  MAX_QUEUE_TOTAL,
  orderQueue,
  type QueueEntry,
  type QueueState,
  type SongRef,
  type TurnState,
} from '@ktv/shared';

/**
 * One room's queue and current turn (Q-03, Q-05, Q-06). Pure in-memory bookkeeping, no I/O —
 * `RoomState` composes this and `RoomLiveService` decides what to broadcast.
 */
export class RoomQueue {
  private entries: QueueEntry[] = [];
  current: TurnState | null = null;
  private readonly sungCount = new Map<string, number>();
  /** Only increases, like `PlaybackState.rev` — the browser ignores a `queue:state` older than one it already has. */
  private rev = 0;

  /** Pending entries in round-robin order (Q-05); the running turn is not part of this list. */
  ordered(): QueueEntry[] {
    return orderQueue(this.entries, this.sungCount);
  }

  add(
    song: SongRef,
    singerId: string,
    singerName: string,
    nowMs: number,
    invite: QueueEntry['invite'] = null,
  ): { ok: true; entryId: string } | { ok: false; error: string } {
    const ownCount = this.entries.filter((e) => e.singerId === singerId).length;
    if (ownCount >= MAX_QUEUE_PER_USER) return { ok: false, error: 'Bạn đang có 5 bài trong danh sách rồi' };
    if (this.entries.length >= MAX_QUEUE_TOTAL) return { ok: false, error: 'Danh sách phòng đã đầy' };
    const entry: QueueEntry = { id: randomUUID(), song, singerId, singerName, addedAtMs: nowMs, partnerId: null, partnerName: null, invite };
    this.entries.push(entry);
    this.rev++;
    return { ok: true, entryId: entry.id };
  }

  /** Only the owner may remove their own pending entry (Q-06); the running turn is not removable here. */
  removeOwn(entryId: string, userId: string): { ok: true } | { ok: false; error: string } {
    const entry = this.entries.find((e) => e.id === entryId);
    if (!entry) return { ok: false, error: 'Không tìm thấy bài hát này' };
    if (entry.singerId !== userId) return { ok: false, error: 'Chỉ xoá được bài của bạn' };
    this.entries = this.entries.filter((e) => e.id !== entryId);
    this.rev++;
    return { ok: true };
  }

  /** Drops every pending entry queued by a member who left for good (phase 05). */
  removeAllOf(userId: string) {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.singerId !== userId);
    if (this.entries.length !== before) this.rev++;
  }

  /* ----- duet invites (S-07..S-11) ----- */

  /** 1-based place of a pending entry in the round-robin order, or 0 if it is not pending. */
  position(entryId: string): number {
    return this.ordered().findIndex((e) => e.id === entryId) + 1;
  }

  /** The invited person says yes or no (S-09). Returns the entry so the caller can tell the inviter. */
  answerInvite(entryId: string, userId: string, yes: boolean): { ok: true; entry: QueueEntry } | { ok: false; error: string } {
    const entry = this.entries.find((e) => e.id === entryId);
    if (!entry?.invite || entry.invite.toId !== userId) return { ok: false, error: 'Lời mời này không còn nữa' };
    const toName = entry.invite.toName;
    entry.invite = null;
    if (yes) {
      entry.partnerId = userId;
      entry.partnerName = toName;
    }
    this.rev++;
    return { ok: true, entry };
  }

  /** The inviter takes the invite back (S-10); the song stays theirs, solo. */
  cancelInvite(entryId: string, userId: string): { ok: true } | { ok: false; error: string } {
    const entry = this.entries.find((e) => e.id === entryId);
    if (!entry?.invite || entry.singerId !== userId) return { ok: false, error: 'Không có lời mời nào để huỷ' };
    entry.invite = null;
    this.rev++;
    return { ok: true };
  }

  /** Invites with no answer in time; they become solo entries (S-09). Returns those entries. */
  expireInvites(nowMs: number): QueueEntry[] {
    const expired = this.entries.filter((e) => e.invite && e.invite.expiresAtMs <= nowMs);
    for (const e of expired) e.invite = null;
    if (expired.length) this.rev++;
    return expired;
  }

  /** Someone left for good: invites to them lapse, duets with them become solo. Returns affected entries. */
  forgetPartner(userId: string): QueueEntry[] {
    const hit = this.entries.filter((e) => e.invite?.toId === userId || e.partnerId === userId);
    for (const e of hit) {
      e.invite = null;
      e.partnerId = null;
      e.partnerName = null;
    }
    if (hit.length) this.rev++;
    return hit;
  }

  /** Removes and returns the next entry to sing, in round-robin order, or null when empty. */
  shift(): QueueEntry | null {
    const next = this.ordered()[0];
    if (!next) return null;
    this.entries = this.entries.filter((e) => e.id !== next.id);
    this.rev++;
    return next;
  }

  /** Records one more song sung this session, so round-robin stays fair (Q-05). */
  sung(userId: string) {
    this.sungCount.set(userId, (this.sungCount.get(userId) ?? 0) + 1);
  }

  /** Sets (or clears) the running turn and bumps `rev`, so a turn change is never a stale broadcast. */
  setCurrent(turn: TurnState | null) {
    this.current = turn;
    this.rev++;
  }

  state(): QueueState {
    return { current: this.current, entries: this.ordered(), rev: this.rev };
  }
}
