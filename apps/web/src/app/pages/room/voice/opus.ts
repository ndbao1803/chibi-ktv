/**
 * Opus settings for singing (S-05): mono, no silence skipping (DTX off, it cuts held notes),
 * error correction on, up to 96 kbps. Applied by editing the session description.
 */
export function tuneOpus(sdp: string): string {
  const m = /a=rtpmap:(\d+) opus\/48000/i.exec(sdp);
  if (!m) return sdp;
  const pt = m[1];
  const wanted: Record<string, string> = { stereo: '0', 'sprop-stereo': '0', usedtx: '0', useinbandfec: '1', maxaveragebitrate: '96000' };
  const fmtp = new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`);
  const existing = fmtp.exec(sdp);
  const params = new Map<string, string>();
  for (const kv of (existing?.[1] ?? '').split(';')) {
    const [k, v] = kv.split('=');
    if (k?.trim()) params.set(k.trim(), (v ?? '').trim());
  }
  for (const [k, v] of Object.entries(wanted)) params.set(k, v);
  const line = `a=fmtp:${pt} ${[...params].map(([k, v]) => `${k}=${v}`).join(';')}`;
  return existing ? sdp.replace(fmtp, line) : sdp.replace(m[0], `${m[0]}\r\n${line}`);
}
