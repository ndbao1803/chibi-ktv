import { tuneOpus } from './opus';

describe('tuneOpus', () => {
  const sdp = 'm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;useinbandfec=1;usedtx=1\r\n';

  it('turns DTX off, keeps other settings and adds the music bitrate', () => {
    const out = tuneOpus(sdp);
    expect(out).toContain('minptime=10');
    expect(out).toContain('usedtx=0');
    expect(out).toContain('maxaveragebitrate=96000');
    expect(out).not.toContain('usedtx=1');
  });

  it('adds an fmtp line when there is none', () => {
    const out = tuneOpus('a=rtpmap:109 opus/48000/2\r\n');
    expect(out).toMatch(/a=fmtp:109 .*stereo=0/);
  });
});
