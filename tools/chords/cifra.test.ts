import { describe, expect, it } from 'vitest';
import { applyTiming, guitarUrl, keyboardUrl, matchSongId, parseCifraHtml, parseUrlList, translateCredits } from './cifra';
import { applyDurationTiming } from './timing';
import { parseChordPro } from '../../src/domain/chordPro';
import { sheetLineSegments } from '../../src/domain/chordSheet';

// Original text, representative current Cifra DOM. No fetched song lyrics.
const fixture = `<html><body><div><h1>Original Study</h1><h2>Test Artist</h2></div>
<div id="key">Tom: C</div><span data-bpm="96"></span>
<ul data-instrument="keyboard"><li><div data-chord-mode="keyboard" data-mount="1 3 5"><strong data-chord-label>C9</strong></div></li></ul>
<pre data-chord-content><div> <b data-chord-name="C9">C9</b>       <b data-chord-name="G7M">G7M</b>
 A new &amp; open day

</div><div><b>C</b> <b>G/B</b> <b>Am7</b> <b>G</b> <b>F</b> <b>Dm7</b> <b>G7</b>
Seven little footsteps lead us home.
</div></pre></body></html>`;
const url = 'https://www.cifraclub.com.br/test-artist/original-study/';

describe('Cifra keyboard importer', () => {
  it('forces keyboard while preserving version parameters and deduplicating input', () => {
    expect(keyboardUrl(`${url}?instrument=guitar&version=2#notes`)).toBe(`${url}?instrument=keyboard&version=2`);
    expect(guitarUrl(`${url}?instrument=keyboard&version=2#notes`)).toBe(`${url}?version=2`);
    expect(parseUrlList(`# input\r\n${url}\n\n${url}?instrument=keyboard`)).toEqual([`${url}?instrument=keyboard`]);
    for (const bad of ['http://www.cifraclub.com.br/a/b/', 'https://evil.test/a/b/', 'https://cifraclub.com.br.evil.test/a/b/', 'https://user@www.cifraclub.com.br/a/b/']) {
      expect(() => keyboardUrl(bad)).toThrow();
      expect(() => guitarUrl(bad)).toThrow();
    }
  });
  it('extracts source metadata, exact text anchors, keyboard interpretation and all seven changes', () => {
    const sheet = parseCifraHtml(fixture, url);
    expect(sheet.title).toBe('Original Study');
    expect(sheet.artist).toBe('Test Artist');
    expect(sheet.key).toBe('C');
    expect(sheet.bpm).toBe(96);
    expect(sheet.lines[0].text).toBe(' A new & open day');
    expect(sheet.lines[0].changes.map((c) => c.column)).toEqual([1, 10]);
    expect(sheet.lines[1].changes.map((c) => c.symbol)).toEqual(['C', 'G/B', 'Am7', 'G', 'F', 'Dm7', 'G7']);
    expect(sheet.chords.find((c) => c.symbol === 'C9')?.canonical).toBe('Cadd9');
    expect(sheet.chords.find((c) => c.symbol === 'G7M')?.canonical).toBe('Gmaj7');
  });
  it('does not invent missing BPM or accept a silent instrument fallback unless explicitly allowed', () => {
    expect(parseCifraHtml(fixture.replace('data-bpm="96"', ''), url).bpm).toBeNull();
    expect(() => parseCifraHtml(fixture.replaceAll('keyboard', 'guitar'), url)).toThrow(/Keyboard/);
    expect(() => parseCifraHtml('<html>Access denied</html>', url)).toThrow(/No chord sheet/);
    const guitarSheet = parseCifraHtml(fixture.replaceAll('keyboard', 'guitar'), url, { allowGuitar: true });
    expect(guitarSheet.instrument).toBe('guitar');
  });
  it('filters out guitar tablature lines and attaches chords directly to lyrics', () => {
    const htmlWithTabs = `<html><body><div><h1>Rock Song</h1><h2>Test Band</h2></div>
<pre data-chord-content>
Guitarra 1 (S/ Dist.)
            <b>B5</b>                    <b>G5</b>                <b>A5</b>
e|---------------------------------------------------|
B|---------------------------------------------------|
G|---4-4-4---4-4-4---4-4-4---4-4-4-------------------2-2-2---2-2-2---|
D|---4-4-4---4-4-4---4-4-4---4-4-4---5-5-5---5-5-5---2-2-2---2-2-2---|
A|---2-2-2---2-2-2---2-2-2---2-2-2---5-5-5---5-5-5---0-0-0---0-0-0---|
E|-----------------------------------3-3-3---3-3-3-------------------|
    If I go crazy then will you still Call me Superman
            <b>B5</b>                    <b>E5</b>                <b>F#5</b>
e|---------------------------------------------------|
B|---------------------------------------------------|
G|---4-4-4---4-4-4---4-4-4---4-4-4---2-2-2---2-2-2---4-4-4---4-4-4---|
D|---4-4-4---4-4-4---4-4-4---4-4-4---2-2-2---2-2-2---4-4-4---4-4-4---|
A|---2-2-2---2-2-2---2-2-2---2-2-2---2-2-2---2-2-2---4-4-4---4-4-4---|
E|-----------------------------------0-0-0---0-0-0---2-2-2---2-2-2---|
    If I am alive and well, will you be holding my hand
</pre></body></html>`;
    const sheet = parseCifraHtml(htmlWithTabs, 'https://www.cifraclub.com.br/test-band/rock-song/', { allowGuitar: true });
    expect(sheet.instrument).toBe('guitar');
    expect(sheet.lines).toHaveLength(2);
    expect(sheet.lines[0].text).toBe('    If I go crazy then will you still Call me Superman');
    expect(sheet.lines[0].changes.map((c) => c.symbol)).toEqual(['B5', 'G5', 'A5']);
    expect(sheet.lines[1].text).toBe('    If I am alive and well, will you be holding my hand');
    expect(sheet.lines[1].changes.map((c) => c.symbol)).toEqual(['B5', 'E5', 'F#5']);
  });
  it('extracts and translates song credits to english', () => {
    expect(translateCredits('Composição: Brad Arnold, Todd Harrell e Matt Haze')).toBe('Composed by: Brad Arnold, Todd Harrell and Matt Haze');
    expect(translateCredits('Composição: Paraiba')).toBe('Composed by: Paraiba');
    expect(translateCredits('Composição de: John Lennon e Paul McCartney')).toBe('Composed by: John Lennon and Paul McCartney');

    const htmlWithCredits = `<html><body><div><h1>Song</h1><h2>Artist</h2></div>
<pre data-chord-content><b>C</b>
Hello</pre>
<p class="song-info">Composição: Brad Arnold, Todd Harrell e Matt Haze</p>
</body></html>`;
    const sheet = parseCifraHtml(htmlWithCredits, 'https://www.cifraclub.com.br/artist/song/', { allowGuitar: true });
    expect(sheet.credits).toBe('Composed by: Brad Arnold, Todd Harrell and Matt Haze');
  });
  it('handles legacy pre containers, entities, tabs and chord-only sections', () => {
    const html = fixture.replace(/<pre[\s\S]*?<\/pre>/, '<pre class="cifra_cnt">[Intro]\n\t<b>C</b> <b>G</b>\n\n<b>Am7</b>\nOpen &lt;sky&gt;\n</pre>');
    const sheet = parseCifraHtml(html, url);
    expect(sheet.lines[0].kind).toBe('section');
    expect(sheet.lines[1].kind).toBe('instrumental');
    expect(sheet.lines[1].changes[0].column).toBe(8);
    expect(sheet.lines[2].text).toBe('Open <sky>');
  });
  it('retains unknown symbols instead of dropping or hallucinating chords', () => {
    const sheet = parseCifraHtml(fixture.replaceAll('G7M', 'Gadd99'), url);
    expect(sheet.chords.find((c) => c.symbol === 'Gadd99')?.canonical).toBeNull();
    expect(sheet.lines[0].changes[1].symbol).toBe('Gadd99');
  });
  it('keeps block-wrapped chord rows paired with lyrics despite HTML formatting whitespace', () => {
    const html = fixture.replace(/<pre[\s\S]*?<\/pre>/, `<pre data-chord-content>
      <div>  <b>C</b>        <b>G</b></div>
      <div>  Morning &amp; evening stay.</div>
      <div><b>Am7</b>     <b>F</b></div>
      <div>Hold the light.</div>
    </pre>`);
    const sheet = parseCifraHtml(html, url);
    expect(sheet.lyrics).toBe('included');
    expect(sheet.lines).toHaveLength(2);
    expect(sheet.lines.map((line) => line.text)).toEqual(['  Morning & evening stay.', 'Hold the light.']);
    expect(sheet.lines.map((line) => line.changes.map((change) => change.column))).toEqual([[2, 11], [0, 8]]);
    expect(sheet.lines.every((line) => line.kind === 'lyric')).toBe(true);
  });
  it('preserves Intro and Riff labels without attaching the next lyric to an intro chord', () => {
    const html = fixture.replace(/<pre[\s\S]*?<\/pre>/, `<pre data-chord-content>Intro: <b>D</b>
Riff 1:
<b>D</b>
Let the open string ring.
                 <b>D</b>  <b>Em</b>
Hold on.
</pre>`);
    const sheet = parseCifraHtml(html, url);
    expect(sheet.lines.map((line) => [line.kind, line.text])).toEqual([
      ['instrumental', 'Intro:'], ['section', 'Riff 1:'],
      ['lyric', 'Let the open string ring.'], ['lyric', 'Hold on.'],
    ]);
    expect(sheet.lines[2].changes.map((change) => change.symbol)).toEqual(['D']);
    expect(sheet.lines[3].changes.map((change) => [change.symbol, change.column])).toEqual([['D', 17], ['Em', 20]]);
    const segments = sheetLineSegments(sheet.lines[3]);
    expect(segments.map((part) => part.lyric)).toEqual(['Hold on.         ', '   ', '']);
    expect(sheet.lines[3].text).toBe('Hold on.');
  });
  it('preserves accent, entity, tab and line-break anchors through JSON and model timing', () => {
    const html = fixture.replace(/<pre[\s\S]*?<\/pre>/, '<pre data-chord-content>\t<b>C</b>&nbsp;&nbsp;<b>G/B</b><br>\tCéu &amp; chão<br><b>Am7</b> <b>G</b> <b>F</b> <b>C</b> <b>Dm7</b> <b>Em</b> <b>G7</b><br>Seven new steps bring us home.</pre>');
    const sheet = parseCifraHtml(html, url);
    const result = applyTiming(sheet, { lines: sheet.lines.map((line) => ({
      id: line.id, beats: 8, chordBeats: line.changes.map((_, index) => index),
      text: 'Model must not replace the lyrics', changes: [],
    })) }, 'test-model');
    const roundTrip = JSON.parse(JSON.stringify(result));
    expect(roundTrip.lyrics).toBe('included');
    expect(roundTrip.lines.map((line: { text: string }) => line.text)).toEqual(['        Céu & chão', 'Seven new steps bring us home.']);
    expect(result.lines.map((line) => line.changes.map(({ symbol, column }) => ({ symbol, column })))).toEqual(
      sheet.lines.map((line) => line.changes.map(({ symbol, column }) => ({ symbol, column }))),
    );
    expect(result.lines[1].changes).toHaveLength(7);
  });
  it('matches artist plus title, reuses IDs, and refuses ambiguous matches', () => {
    const row = { id: 'existing-arrangement', title: 'Sexto Andar', composer: 'Fresno' };
    expect(matchSongId('Sexto Andar', 'FRESNO', [row], 'new-id')).toBe('existing-arrangement');
    expect(matchSongId('Sexto Andar', 'Other Artist', [row], 'new-id')).toBe('new-id');
    expect(matchSongId('Canção', 'Ártista', [{ id: 'same', title: 'Cancao', composer: 'Artista' }], 'new')).toBe('same');
    expect(() => matchSongId(row.title, row.composer, [row, { ...row, id: 'ambiguous' }], 'new')).toThrow(/Ambiguous/);
  });
});

describe('bounded Ollama timing', () => {
  const sheet = parseChordPro('{title: Study}\n{artist: Us}\n[C]One [Dm]two [Em]three [F]four [G]five [Am]six [Bdim]seven.', 'study');
  it('derives strictly ordered boundaries from seven positive durations', () => {
    const result = applyDurationTiming(sheet, { lines: [{ id: 'line-1', durations: [1, 1, 1, 1, 1, 1, 2], restBeats: 0 }] }, 'qwen3.5:4b');
    expect(result.lines[0].beats).toBe(8);
    expect(result.lines[0].changes.map((c) => c.beat)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(result.lines[0].text).toBe(sheet.lines[0].text);
    expect(result.lines[0].changes.map((c) => c.symbol)).toEqual(sheet.lines[0].changes.map((c) => c.symbol));
    expect(result.bpm).toBeNull();
  });
  it('rejects missing chords, duplicate IDs, backwards boundaries and invented timing', () => {
    expect(() => applyDurationTiming(sheet, { lines: [{ id: 'line-1', durations: [4], restBeats: 0 }] }, 'model')).toThrow();
    expect(() => applyDurationTiming(sheet, { lines: [{ id: 'line-1', durations: [-1, 1, 1, 1, 1, 1, 1], restBeats: 0 }] }, 'model')).toThrow();
    expect(() => applyTiming(sheet, { lines: [{ id: 'wrong', beats: 8, chordBeats: [0, 1, 2, 3, 4, 5, 6] }] }, 'model')).toThrow();
    expect(() => applyTiming(sheet, { lines: [{ id: 'line-1', beats: 4, chordBeats: [0, 1, 2, 3, 4, 5, 6] }] }, 'model')).toThrow();
  });
});
