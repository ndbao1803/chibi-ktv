import { Controller, Get, Logger, UseGuards } from '@nestjs/common';
import type { IceServersResponse } from '@ktv/shared';
import { AuthGuard } from '../auth/auth.guard.js';
import { config } from '../config.js';

const FREE_STUN = { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] };
type IceServer = IceServersResponse['iceServers'][number];

/**
 * ICE servers for WebRTC. STUN (free, no key) lets most browsers connect directly.
 * With a Cloudflare TURN key, short-lived relay credentials are added for blocked networks.
 */
@Controller('api/rtc')
@UseGuards(AuthGuard)
export class RtcController {
  private readonly log = new Logger(RtcController.name);
  private cached?: { at: number; servers: IceServer[] };

  @Get('ice')
  async ice(): Promise<IceServersResponse> {
    const { CF_TURN_KEY_ID: id, CF_TURN_KEY_TOKEN: token } = config();
    if (!id || !token) return { iceServers: [FREE_STUN] };
    // Credentials last 24 h; reuse them for an hour so we call Cloudflare rarely.
    if (this.cached && Date.now() - this.cached.at < 3600_000) return { iceServers: this.cached.servers };
    try {
      const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${id}/credentials/generate-ice-servers`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: 86400 }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`Cloudflare TURN ${res.status}`);
      const body = (await res.json()) as { iceServers: IceServer | IceServer[] };
      const list = Array.isArray(body.iceServers) ? body.iceServers : [body.iceServers];
      // Browsers block port 53, so drop those addresses.
      const servers = list.map((s) => ({
        ...s,
        urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u)),
      }));
      this.cached = { at: Date.now(), servers };
      return { iceServers: servers };
    } catch (e) {
      this.log.warn(`TURN credentials failed, using STUN only: ${(e as Error).message}`);
      return { iceServers: [FREE_STUN] };
    }
  }
}
