"""WhisperBook pipeline. Runs on Kaggle (started by the website's admin page) as a private script.

  mode 'inspect' (CPU): read the audiobook's chapter marks and the ebook's sections so a person can confirm them.
  mode 'process' (GPU): transcribe with faster-whisper (same settings as the Colab notebook), align the transcript to
                        the ebook (prepare_student_book.py), split the audio at chapter marks, upload everything to
                        R2 through the site, and register the book (hidden until it is published).

The job config (JOB) is injected by the site: callback address, one-off token, file URLs, book details.
This file, prepare_student_book.py and prepare_whispersync.py live in the private Kaggle dataset josh123benja/wb-tools
(refresh it with scripts/update-kaggle-tools.sh after changing them).
"""
import gzip, hashlib, json, os, re, shutil, subprocess, sys, time, traceback
from pathlib import Path

import requests

W = Path('/kaggle/working')
TOOLS = Path(__file__).resolve().parent
CODEC_EXT = {'aac': 'm4a', 'alac': 'm4a', 'mp3': 'mp3', 'opus': 'opus', 'vorbis': 'ogg', 'flac': 'flac'}
CONTENT_TYPES = {'m4a': 'audio/mp4', 'mp3': 'audio/mpeg', 'opus': 'audio/ogg', 'ogg': 'audio/ogg', 'flac': 'audio/flac'}
MIN_COVERAGE, MAX_RUN = 0.975, 60          # every published book matched 97.8%-99.1%; longest guessed run was 42 words
PART = 48 * 1024 * 1024


class Job:
    def __init__(self, cfg):
        self.cfg = cfg
        self.url = f"{cfg['base']}/api/job/{cfg['jobId']}"
        self.headers = {'x-job-token': cfg['token']}
        self._last = 0

    def post(self, event, **data):
        for attempt in range(4):
            try:
                r = requests.post(self.url, json={'event': event, **data}, headers=self.headers, timeout=60)
                if r.ok: return r.json()
                if r.status_code in (400, 401): raise RuntimeError(f'{event}: {r.status_code} {r.text[:200]}')
            except requests.RequestException:
                pass
            time.sleep(2 * (attempt + 1))
        raise RuntimeError(f'could not reach the site for "{event}"')

    def progress(self, stage, pct, message, force=False, eta=None, pos=None, item=None):
        if not force and time.time() - self._last < 4: return
        self._last = time.time()
        print(f'[{stage} {pct:.0f}%] {message}', flush=True)
        try: self.post('progress', stage=stage, pct=pct, message=message, eta=eta, pos=pos, item=item)
        except Exception as e: print('progress not delivered:', e, flush=True)

    def upload(self, key, path, ctype, cache=None):
        size = Path(path).stat().st_size
        params = {'key': key, **({'cache': cache} if cache else {})}
        if size <= 80 * 1024 * 1024:
            for attempt in range(3):
                with open(path, 'rb') as f:
                    r = requests.put(self.url, params=params, data=f, headers={**self.headers, 'content-type': ctype}, timeout=600)
                if r.ok: return
                time.sleep(3 * (attempt + 1))
            raise RuntimeError(f'upload of {key} failed: {r.status_code} {r.text[:200]}')
        r = requests.post(self.url, params={**params, 'mp': 'create', 'type': ctype}, headers=self.headers, timeout=60); r.raise_for_status()
        upload_id, parts = r.json()['uploadId'], []
        with open(path, 'rb') as f:
            n = 0
            while chunk := f.read(PART):
                n += 1
                for attempt in range(3):
                    r = requests.put(self.url, params={'key': key, 'mp': 'part', 'uploadId': upload_id, 'n': n}, data=chunk, headers={**self.headers, 'content-type': 'application/octet-stream'}, timeout=900)
                    if r.ok: break
                    time.sleep(3 * (attempt + 1))
                else: raise RuntimeError(f'part {n} of {key} failed: {r.status_code}')
                parts.append({'partNumber': n, 'etag': r.json()['etag']})
        r = requests.post(self.url, params={'key': key, 'mp': 'complete'}, json={'uploadId': upload_id, 'parts': parts}, headers=self.headers, timeout=120); r.raise_for_status()


def sh(cmd, **kw):
    r = subprocess.run([str(c) for c in cmd], capture_output=True, text=True, **kw)
    if r.returncode: raise RuntimeError(f'{" ".join(str(c) for c in cmd)[:160]}\n{(r.stderr or r.stdout)[-1200:]}')
    return r


def ffprobe(src):
    return json.loads(sh(['ffprobe', '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '-show_chapters', src]).stdout)


def chapters_of(probe):
    out = []
    for i, c in enumerate(probe.get('chapters', [])):
        out.append({'title': (c.get('tags') or {}).get('title') or f'Chapter {i + 1}', 'start': float(c['start_time']), 'end': float(c['end_time'])})
    return out


def clean_title(t):
    """Audio chapter names often carry a track number and the running time ('03-Part 2 - ... - Chapter 03  - 00:43:08'); readers only need the name."""
    t = re.sub(r'\s*-\s*\d{1,2}:\d{2}:\d{2}\s*$', '', t or '').strip()
    return re.sub(r'^\d{1,3}\s*-\s*(?=\D)', '', t).strip() or t


def combined_chapters(probes, names):
    """Chapters of several audio files played back to back, on the timeline of the joined file. A file without marks becomes one chapter."""
    out, offset = [], 0.0
    for probe, name in zip(probes, names):
        own = chapters_of(probe) if probe.get('chapters') else [{'title': re.sub(r'\.[^.]+$', '', name), 'start': 0.0, 'end': float(probe['format']['duration'])}]
        out += [{'title': clean_title(c['title']), 'start': offset + c['start'], 'end': offset + c['end']} for c in own]
        offset += float(probe['format']['duration'])
    return out, offset


def join_audio(parts, chapters, dest):
    """Join the parts without re-encoding and write the chapter marks into the result."""
    lst = dest.with_suffix('.txt'); meta = dest.with_suffix('.ffmeta')
    lst.write_text(''.join("file '" + str(p).replace("'", "'\\''") + "'\n" for p in parts))
    esc = lambda t: re.sub(r'([=;#\\\n])', r'\\\1', t)
    meta.write_text(';FFMETADATA1\n' + ''.join(f'[CHAPTER]\nTIMEBASE=1/1000\nSTART={round(c["start"] * 1000)}\nEND={round(c["end"] * 1000)}\ntitle={esc(c["title"])}\n' for c in chapters))
    sh(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', lst, '-i', meta, '-map', '0:a:0', '-map_metadata', '1', '-map_chapters', '1', '-c', 'copy', '-f', 'ipod', dest])
    return dest


def download(job, item, dest, stage, lo, hi):
    dest.parent.mkdir(parents=True, exist_ok=True)
    with requests.get(item['url'], stream=True, timeout=120) as r:
        r.raise_for_status()
        total, got = int(r.headers.get('content-length', 0)), 0
        with open(dest, 'wb') as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk); got += len(chunk)
                if total: job.progress(stage, lo + (hi - lo) * got / total, f'Downloading {item["name"]} ({got >> 20} of {total >> 20} MB)')
    return dest


def setup_tools():
    """Recreate the repo layout prepare_student_book.py expects: <root>/prepare_whispersync.py and <root>/ReaderWebsite/scripts/."""
    (W / 'ReaderWebsite' / 'scripts').mkdir(parents=True, exist_ok=True)
    shutil.copy(TOOLS / 'prepare_whispersync.py', W / 'prepare_whispersync.py')
    shutil.copy(TOOLS / 'prepare_student_book.py', W / 'ReaderWebsite' / 'scripts' / 'prepare_student_book.py')
    for mod in ('bs4', 'lxml', 'rapidfuzz'):
        try: __import__(mod)
        except ImportError: subprocess.run([sys.executable, '-m', 'pip', '-q', 'install', {'bs4': 'beautifulsoup4'}.get(mod, mod)], check=True)
    sys.path[:0] = [str(W), str(W / 'ReaderWebsite' / 'scripts')]


# ------------------------------------------------------------------ inspect
def inspect(job):
    cfg = job.cfg
    job.progress('inspect', 5, 'Reading the audiobook’s chapter marks', force=True)
    parts = cfg.get('audioParts')
    if parts:
        probes = [ffprobe(p['url']) for p in parts]
        probe = probes[0]
        chapters, total = combined_chapters(probes, [p['name'] for p in parts]); notes = [f'The audiobook is {len(parts)} files, joined in this order: ' + ', '.join(p['name'] for p in parts) + '.']
        probe['format']['duration'] = str(total)
    else:
        try: probe = ffprobe(cfg['audio']['url'])
        except Exception:
            job.progress('inspect', 8, 'Downloading the audiobook to read it…', force=True)
            probe = ffprobe(str(download(job, cfg['audio'], W / 'in' / cfg['audio']['name'], 'inspect', 8, 40)))
        chapters, notes = chapters_of(probe), []
    stream = next(s for s in probe['streams'] if s['codec_type'] == 'audio')
    ext = CODEC_EXT.get(stream['codec_name'])
    if not ext: raise RuntimeError(f'Unsupported audio format ({stream["codec_name"]}).')
    if not chapters:
        raise RuntimeError('This audio file has no chapter marks. Add verified chapters first (look up the official chapter list for this edition, '
                           'then: ffmpeg -i in.m4b -i chapters.ffmetadata -map 0:a:0 -map_metadata 0 -map_chapters 1 -c copy out.m4b), and upload that file.')
    duration = float(probe['format']['duration'])
    if not cfg.get('epub'):
        notes.append('No ebook was given, so the reading text will be the Whisper transcript, cut at these chapter marks. Names and unusual spellings may be off.')
        job.post('inspected', chapters=chapters, duration=duration, codec=stream['codec_name'], ext=ext, epub=None, notes=notes)
        print('INSPECT DONE (no ebook)', len(chapters), 'chapters', flush=True); return
    job.progress('inspect', 50, 'Reading the ebook’s sections', force=True)
    setup_tools()
    epub_path = download(job, cfg['epub'], W / 'in' / cfg['epub']['name'], 'inspect', 50, 60)
    import prepare_student_book as psb
    sections = psb.extract(Path(epub_path))
    words = sum(len(s['words']) for s in sections)
    if abs(len(sections) - len(chapters)) > max(3, len(chapters) // 4):
        notes.append(f'The ebook has {len(sections)} sections but the audio has {len(chapters)} chapters. That is normal if one lists parts or credits the other does not, but check it.')
    if duration < 1800: notes.append('The audiobook is under 30 minutes long. Is this the full recording?')
    job.post('inspected', chapters=chapters, duration=duration, codec=stream['codec_name'], ext=ext,
             epub={'sections': len(sections), 'words': words, 'titles': [s['title'][:80] for s in sections][:300]}, notes=notes)
    print('INSPECT DONE', len(chapters), 'chapters', flush=True)


# ------------------------------------------------------------------ process
def plan_chunks(src, duration, target=900.0, slack=90.0):
    """Cut points (seconds) about every `target` seconds, each moved to the middle of the nearest pause so no word is split."""
    r = subprocess.run(['ffmpeg', '-v', 'info', '-i', src, '-af', 'silencedetect=noise=-32dB:d=0.35', '-f', 'null', '-'], capture_output=True, text=True)
    starts = [float(x) for x in re.findall(r'silence_start: ([\d.]+)', r.stderr)]
    ends = [float(x) for x in re.findall(r'silence_end: ([\d.]+)', r.stderr)]
    mids = [(a + b) / 2 for a, b in zip(starts, ends)]
    cuts, t = [0.0], target
    while t < duration - slack:
        near = [m for m in mids if abs(m - t) <= slack and m > cuts[-1] + 60]
        cuts.append(min(near, key=lambda m: abs(m - t)) if near else t)
        t = cuts[-1] + target
    cuts.append(duration)
    return cuts


def transcribe(job, src, duration, prompt):
    subprocess.run([sys.executable, '-m', 'pip', '-q', 'install', 'faster-whisper'], check=True)
    import torch
    from faster_whisper import WhisperModel
    assert torch.cuda.is_available(), 'No GPU is attached to this Kaggle session'
    job.progress('transcribe', 20, f'Loading Whisper on {torch.cuda.get_device_name(0)}', force=True)
    model = WhisperModel('turbo', device='cuda', compute_type='float16')
    # Long books do not fit in memory in one go (the whole recording is decoded at once), so work in ~15 minute pieces cut where the narrator pauses.
    cuts = plan_chunks(src, duration)
    rows, words, seg_id = [], [], 0
    t0 = time.time()
    # Same settings as the Colab notebook: word timestamps, no carry-over between chunks, voice-activity filter, title/author prompt.
    for lo, hi in zip(cuts, cuts[1:]):
        wav = W / 'chunk.wav'
        sh(['ffmpeg', '-v', 'error', '-y', '-ss', f'{lo:.3f}', '-t', f'{hi - lo:.3f}', '-i', src, '-ac', '1', '-ar', '16000', wav])
        segments, info = model.transcribe(str(wav), language='en', word_timestamps=True, condition_on_previous_text=False, vad_filter=True, beam_size=5, initial_prompt=prompt)
        for seg in segments:
            ws = [{'word': w.word, 'start': lo + float(w.start), 'end': lo + float(w.end), 'probability': float(w.probability)} for w in (seg.words or [])]
            words.extend(ws); rows.append({'id': seg_id, 'start': lo + float(seg.start), 'end': lo + float(seg.end), 'text': seg.text, 'words': ws}); seg_id += 1
            done = lo + float(seg.end); spent = time.time() - t0
            # Time left = remaining audio at the speed so far, plus the alignment, splitting and upload that follow (a few minutes plus ~30 s per hour of audio).
            eta = (duration - done) * spent / max(done, 1) + 120 + 30 * duration / 3600 if done > 120 else None
            job.progress('transcribe', 20 + 40 * min(1, done / duration), f'Transcribing: {int(done // 60)} of {int(duration // 60)} minutes', eta=eta, pos=done)
        wav.unlink(missing_ok=True)
    took = time.time() - t0
    if len(words) < duration / 6: raise RuntimeError(f'The transcript looks too short ({len(words)} words for {duration / 3600:.1f} h of audio).')
    loops = max((sum(1 for _ in g) for _, g in __import__('itertools').groupby(r['text'].strip().lower() for r in rows)), default=0)
    return {'text': ' '.join(r['text'] for r in rows), 'segments': rows, 'words': words, 'language': 'en',
            'metadata': {'model': 'faster-whisper/turbo', 'word_timestamps': True, 'timebase': 'seconds from start of complete audiobook', 'duration': duration,
                         'segment_count': len(rows), 'word_count': len(words), 'quality_passed': loops < 8, 'repeated_segment_run': loops,
                         'transcribe_seconds': round(took, 1), 'speed_x_realtime': round(duration / took, 1)}}


def split_chapters(out, book_id, meta):
    """Some ebooks (scans, single-file conversions) have no chapter breaks, so the whole book is one reader chapter. When the audio has
    many more chapters than the ebook has sections, cut the text at the paragraph where each audio chapter starts being read."""
    from bs4 import BeautifulSoup
    path = out / f'{book_id}.reader.json.gz'
    data = json.loads(gzip.decompress(path.read_bytes()))
    marks = [m for m in data['markers'] if m['end'] > data['introEnd'] and m['start'] < data['creditsStart']]
    if len(data['chapters']) * 2 >= len(marks): return
    BLOCK = ['p', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']
    result = []
    for ch in data['chapters']:
        cues, first_cue, last_cue = ch['cues'], ch['start'], ch['end']
        inside = [m for m in marks if first_cue + 20 < m['start'] < last_cue]
        if not inside: result.append(ch); continue
        soup = BeautifulSoup(ch['html'], 'html.parser')
        first_word = {}
        for block in soup.find_all(BLOCK):
            if block.find(BLOCK): continue
            w = block.find('span', attrs={'data-word': True})
            if w: first_word[id(block)] = int(w['data-word'])
        starts = sorted(set(first_word.values()))
        cuts, cut_titles = [0], [next((m['title'] for m in reversed(marks) if m['start'] <= first_cue + 5), ch['title'])]
        for m in inside:
            k = next((i for i, c in enumerate(cues) if c[0] >= m['start'] - 1.5), None)
            if k is None: continue
            k = max((x for x in starts if x <= k), default=0)
            if k > cuts[-1]: cuts.append(k); cut_titles.append(m['title'])
        cuts.append(len(cues))
        for j, title in enumerate(cut_titles):
            a, b = cuts[j], cuts[j + 1]
            piece = BeautifulSoup(ch['html'], 'html.parser')
            for block in piece.find_all(BLOCK):
                if block.find(BLOCK): continue
                w = block.find('span', attrs={'data-word': True})
                if w is None: 
                    if j: block.decompose()
                    continue
                idx = int(w['data-word'])
                if not a <= idx < b: block.decompose()
            for w in piece.find_all('span', attrs={'data-word': True}): w['data-word'] = str(int(w['data-word']) - a)
            result.append(dict(title=title, html=str(piece), cues=cues[a:b], sentences=[[x - a, y - a] for x, y in ch['sentences'] if a <= x < b], start=cues[a][0], end=cues[b - 1][1]))
    for x, y in zip(result, result[1:]): x['end'] = y['start']
    result[-1]['end'] = data['creditsStart']
    data['chapters'] = result
    packed = json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode()
    path.write_bytes(gzip.compress(packed, mtime=0))
    meta['chapters'] = [{k: c[k] for k in ('title', 'start', 'end')} for c in result]
    meta['assetRevision'] = hashlib.sha256(packed).hexdigest()[:16]
    meta['chapterCount'] = len(result)


def transcript_book(out, book_id, cfg, transcript, probe, duration):
    """No ebook: the reader text is the Whisper transcript itself, cut into chapters at the audiobook's own chapter marks."""
    import html as htmllib
    markers = [dict(title=clean_title((c.get('tags') or {}).get('title') or f'Chapter {i + 1}'), start=float(c['start_time']), end=float(c['end_time'])) for i, c in enumerate(probe['chapters'])]
    is_credit = lambda t: bool(re.search(r'credits?$|^opening credits|^end credits|copyright|about the (author|publisher)', t.strip(), re.I))
    words = [w for w in transcript['words'] if w['word'].strip()]
    chapters, stats_words = [], 0
    for m in markers:
        if is_credit(m['title']): continue
        ws = [w for w in words if m['start'] <= w['start'] < m['end']]
        if len(ws) < 5: continue
        parts, sentences, cues, para, count, sent_start, last_end = [], [], [], [], 0, 0, None
        for i, w in enumerate(ws):
            text = w['word'].strip(); cues.append([round(w['start'], 3), round(w['end'], 3)])
            para.append(f'<span class="word" data-word="{i}">{htmllib.escape(text)}</span>')
            ends = bool(re.search(r'[.!?]["”’\')]*$', text)); gap = (ws[i + 1]['start'] - w['end']) if i + 1 < len(ws) else 9
            if ends: sentences.append([sent_start, i + 1]); sent_start = i + 1
            if i + 1 == len(ws) or (ends and (gap >= 1.1 or len(para) >= 110)):
                if sent_start != i + 1: sentences.append([sent_start, i + 1]); sent_start = i + 1
                parts.append('<p>' + ' '.join(para) + '</p>'); para = []
        html = f'<div class="chapter-text">\n<h1>{htmllib.escape(m["title"])}</h1>\n' + '\n'.join(parts) + '\n</div>'
        chapters.append(dict(title=m['title'], html=html, cues=cues, sentences=sentences, start=cues[0][0], end=cues[-1][1])); stats_words += len(ws)
    if not chapters: raise RuntimeError('No narrated chapters were found in the audiobook.')
    for a, b in zip(chapters, chapters[1:]): a['end'] = b['start']
    credits = next((m['start'] for m in markers if is_credit(m['title']) and m['start'] > chapters[-1]['start']), duration)
    chapters[-1]['end'] = credits
    data = dict(audioOnlyIntroduction=False, version=1, id=book_id, title=cfg['title'], author=cfg['author'], duration=duration, introEnd=chapters[0]['start'], creditsStart=credits, chapters=chapters, markers=markers)
    packed = json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode()
    (out / f'{book_id}.reader.json.gz').write_bytes(gzip.compress(packed, mtime=0))
    meta = {k: v for k, v in data.items() if k != 'chapters'}
    meta['chapters'] = [{k: c[k] for k in ('title', 'start', 'end')} for c in chapters]
    meta['assetRevision'] = hashlib.sha256(packed).hexdigest()[:16]; meta['chapterCount'] = len(chapters)
    return meta, stats_words


def process(job):
    cfg = job.cfg
    book_id = cfg['bookId']
    setup_tools()
    if cfg.get('audioParts'):
        parts, n = [], len(cfg['audioParts'])
        for i, item in enumerate(cfg['audioParts']):
            parts.append(download(job, item, W / 'in' / item['name'], 'download', 1 + 10 * i / n, 1 + 10 * (i + 1) / n))
        job.progress('download', 11.5, 'Joining the audio files', force=True)
        probes = [ffprobe(str(p)) for p in parts]
        chapters, _ = combined_chapters(probes, [p['name'] for p in cfg['audioParts']])
        audio = join_audio(parts, chapters, W / 'in' / 'joined.m4b')
        for p in parts: p.unlink()
    else:
        audio = download(job, cfg['audio'], W / 'in' / cfg['audio']['name'], 'download', 1, 12)
    epub = download(job, cfg['epub'], W / 'in' / cfg['epub']['name'], 'download', 12, 15) if cfg.get('epub') else None
    cover = download(job, cfg['cover'], W / 'in' / cfg['cover']['name'], 'download', 15, 16) if cfg.get('cover') else None

    import prepare_student_book as psb
    n_sections = len(psb.extract(Path(epub))) if epub else 0
    probe = ffprobe(str(audio))
    stream = next(s for s in probe['streams'] if s['codec_type'] == 'audio')
    ext, duration = CODEC_EXT[stream['codec_name']], float(probe['format']['duration'])
    if not probe.get('chapters'): raise RuntimeError('The audiobook has no chapter marks.')
    with open(audio, 'rb') as fh: sha = hashlib.file_digest(fh, 'sha256').hexdigest()  # provenance in the manifest

    # Whisper works on 16 kHz mono; a small Opus copy keeps memory and disk use low and keeps the same timeline.
    job.progress('transcribe', 17, 'Preparing the audio for transcription', force=True)
    small = W / 'audio-16k.opus'
    sh(['ffmpeg', '-v', 'error', '-y', '-i', audio, '-vn', '-map', '0:a:0', '-ac', '1', '-ar', '16000', '-c:a', 'libopus', '-b:a', '24k', '-application', 'voip', small])
    prompt = f'{cfg["title"]} by {cfg["author"]}.'
    transcript = transcribe(job, str(small), duration, prompt)
    tpath = W / 'transcript.whisper.json.gz'
    with gzip.open(tpath, 'wb', compresslevel=6) as f: f.write(json.dumps(transcript, ensure_ascii=False, separators=(',', ':')).encode())

    job.progress('align', 62, 'Matching the transcript to the ebook' if epub else 'Building the reading text from the transcript', force=True)
    if epub:
        (W / 'book').mkdir(exist_ok=True)
        link = W / 'book' / audio.name
        if link.exists(): link.unlink()
        link.symlink_to(audio)
        probe_path = W / 'book' / f'{book_id}-playable-probe.json'; probe_path.write_text(json.dumps(probe))
        manifest = W / 'manifest.json'
        manifest.write_text(json.dumps([{'id': book_id, 'title': cfg['title'], 'author': cfg['author'], 'audio': str(link), 'epub': str(epub), 'bytes': audio.stat().st_size,
                                         'sha256': sha, 'duration': duration, 'readerSectionIndices': cfg.get('sectionIndices') or list(range(n_sections)), 'chapterProbe': str(probe_path)}]))
        r = subprocess.run([sys.executable, str(W / 'ReaderWebsite' / 'scripts' / 'prepare_student_book.py'), '--manifest', str(manifest), '--book', book_id, '--transcript', str(tpath)],
                           capture_output=True, text=True, cwd=str(W))
        if r.returncode: raise RuntimeError('Alignment failed:\n' + (r.stderr or r.stdout)[-1500:])
        out = W / 'book' / 'Website'
        review = json.loads((out / 'alignment-review.json').read_text())
        meta = json.loads((out / 'book-metadata.json').read_text())
        st, run_len = review['stats'], review['cues'].get('longest_interpolated_run', 0)
        weak = sorted((s for s in review['sections'] if s['wordCount'] >= 20 and s['coverage'] < 0.9), key=lambda s: s['coverage'])
        needs_review = st['coverage'] < MIN_COVERAGE or run_len > MAX_RUN or bool(weak) or not transcript['metadata']['quality_passed']
        job.progress('align', 72, f'Matched {st["coverage"] * 100:.1f}% of the ebook’s words', force=True)

        split_chapters(out, book_id, meta)
    else:
        out = W / 'book' / 'Website'; out.mkdir(parents=True, exist_ok=True)
        meta, nw = transcript_book(out, book_id, cfg, transcript, probe, duration)
        st, run_len, weak = {'coverage': 1.0, 'matched_words': nw, 'book_words': nw}, 0, []
        needs_review = not transcript['metadata']['quality_passed']
        job.progress('align', 72, f'Built the reading text: {nw:,} words', force=True)
    markers = meta['markers']
    seg_dir = W / 'segments'; shutil.rmtree(seg_dir, ignore_errors=True); seg_dir.mkdir()
    for i, m in enumerate(markers):
        sh(['ffmpeg', '-v', 'error', '-y', '-ss', f'{m["start"]:.3f}', '-to', f'{m["end"]:.3f}', '-i', audio, '-map', '0:a:0', '-vn', '-c', 'copy', seg_dir / f'segment-{i:03d}.{ext}'])
        job.progress('split', 72 + 6 * (i + 1) / len(markers), f'Splitting the audio: chapter {i + 1} of {len(markers)}', item=i + 1)
    files = sorted(seg_dir.glob('segment-*'))
    total = sum(float(json.loads(sh(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', f]).stdout)['format']['duration']) for f in files)
    want = markers[-1]['end'] - markers[0]['start']
    if abs(total - want) > max(3.0, len(files) * 0.15): raise RuntimeError(f'The split audio adds up to {total:.0f}s but the chapters cover {want:.0f}s.')

    key = f'reader/{book_id}/{meta["assetRevision"]}.json.gz'
    job.progress('upload', 79, 'Uploading the book', force=True)
    job.upload(key, out / f'{book_id}.reader.json.gz', 'application/gzip')
    for i, f in enumerate(files):
        job.upload(f'audio/{book_id}/{f.name}', f, CONTENT_TYPES.get(ext, 'application/octet-stream'), 'public, max-age=31536000, immutable')
        job.progress('upload', 79 + 18 * (i + 1) / len(files), f'Uploading audio: {i + 1} of {len(files)} chapters', item=i + 1)
    cover_url = '/covers/placeholder.svg'
    cover_jpg = W / 'cover.jpg'
    if cover is None:  # fall back to the artwork embedded in the audiobook
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(audio), '-map', '0:v:0', '-frames:v', '1', str(cover_jpg)], capture_output=True)
        cover = cover_jpg if cover_jpg.exists() else None
    if cover:
        small_cover = W / 'cover-600.jpg'
        sh(['ffmpeg', '-v', 'error', '-y', '-i', cover, '-vf', 'scale=600:-2', '-q:v', '3', small_cover])
        job.upload(f'covers/{book_id}.jpg', small_cover, 'image/jpeg', 'public, max-age=86400')
        cover_url = f'{cfg["media"]}/covers/{book_id}.jpg?v={meta["assetRevision"][:8]}'

    entry = dict(meta, cover=cover_url, prepared=key, audioExtension=ext)
    job.post('register', entry=entry, needsReview=needs_review)
    result = {'mode': 'ebook' if epub else 'transcript', 'bookId': book_id, 'coverage': st['coverage'], 'matchedWords': st['matched_words'], 'bookWords': st['book_words'], 'longestGuessedRun': run_len,
              'weakSections': [{'title': s['title'][:60], 'coverage': s['coverage'], 'unmatched': len(s['unmatched'])} for s in weak[:15]], 'needsReview': needs_review,
              'chapters': len(meta['chapters']), 'hours': round(duration / 3600, 2), 'speedX': transcript['metadata']['speed_x_realtime'],
              'transcriptRepeatRun': transcript['metadata']['repeated_segment_run']}
    job.post('done', result=result)
    print('PROCESS DONE', json.dumps(result), flush=True)


def main(cfg):
    job = Job(cfg)
    try:
        {'inspect': inspect, 'process': process}[cfg['mode']](job)
    except Exception as e:
        traceback.print_exc()
        try: job.post('failed', error=f'{e}'[:1400])
        except Exception: pass
        sys.exit(1)
