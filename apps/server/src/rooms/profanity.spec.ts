import { cleanText } from './profanity.js';

describe('chat word filter (P-05)', () => {
  it('masks Vietnamese swear words and short forms, keeping the rest', () => {
    expect(cleanText('Hát hay đéo chịu được')).toBe('Hát hay *** chịu được');
    expect(cleanText('vcl hay quá')).toBe('*** hay quá');
    expect(cleanText('Đ.M hay')).toBe('*** hay');
  });
  it('masks English ones', () => {
    expect(cleanText('holy SHIT that was good')).toBe('holy **** that was good');
  });
  it('leaves ordinary words alone, even ones that look alike without accents', () => {
    expect(cleanText('Bài này lớn quá, các bạn đeo tai nghe nhé')).toBe('Bài này lớn quá, các bạn đeo tai nghe nhé');
    expect(cleanText('dmca và shitake')).toBe('dmca và shitake');
  });
});
