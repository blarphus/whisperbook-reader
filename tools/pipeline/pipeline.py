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

    def progress(self, stage, pct, message, force=False):
        if not force and time.time() - self._last < 4: return
        self._last = time.time()
        print(f'[{stage} {pct:.0f}%] {message}', flush=True)
        try: self.post('progress', stage=stage, pct=pct, message=message)
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
    try: probe = ffprobe(cfg['audio']['url'])
    except Exception:
        job.progress('inspect', 8, 'Downloading the audiobook to read it…', force=True)
        probe = ffprobe(str(download(job, cfg['audio'], W / 'in' / cfg['audio']['name'], 'inspect', 8, 40)))
    stream = next(s for s in probe['streams'] if s['codec_type'] == 'audio')
    chapters, notes = chapters_of(probe), []
    ext = CODEC_EXT.get(stream['codec_name'])
    if not ext: raise RuntimeError(f'Unsupported audio format ({stream["codec_name"]}).')
    if not chapters:
        raise RuntimeError('This audio file has no chapter marks. Add verified chapters first (look up the official chapter list for this edition, '
                           'then: ffmpeg -i in.m4b -i chapters.ffmetadata -map 0:a:0 -map_metadata 0 -map_chapters 1 -c copy out.m4b), and upload that file.')
    duration = float(probe['format']['duration'])
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
def transcribe(job, src, duration, prompt):
    subprocess.run([sys.executable, '-m', 'pip', '-q', 'install', 'faster-whisper'], check=True)
    import torch
    from faster_whisper import WhisperModel
    assert torch.cuda.is_available(), 'No GPU is attached to this Kaggle session'
    job.progress('transcribe', 20, f'Loading Whisper on {torch.cuda.get_device_name(0)}', force=True)
    model = WhisperModel('turbo', device='cuda', compute_type='float16')
    t0 = time.time()
    # Same settings as the Colab notebook: word timestamps, no carry-over between chunks, voice-activity filter, title/author prompt.
    segments, info = model.transcribe(src, language='en', word_timestamps=True, condition_on_previous_text=False, vad_filter=True, beam_size=5, initial_prompt=prompt)
    rows, words = [], []
    for seg in segments:
        ws = [{'word': w.word, 'start': float(w.start), 'end': float(w.end), 'probability': float(w.probability)} for w in (seg.words or [])]
        words.extend(ws); rows.append({'id': seg.id, 'start': float(seg.start), 'end': float(seg.end), 'text': seg.text, 'words': ws})
        job.progress('transcribe', 20 + 40 * min(1, seg.end / duration), f'Transcribing: {int(seg.end // 60)} of {int(duration // 60)} minutes')
    took = time.time() - t0
    if len(words) < duration / 6: raise RuntimeError(f'The transcript looks too short ({len(words)} words for {duration / 3600:.1f} h of audio).')
    loops = max((sum(1 for _ in g) for _, g in __import__('itertools').groupby(r['text'].strip().lower() for r in rows)), default=0)
    return {'text': ' '.join(r['text'] for r in rows), 'segments': rows, 'words': words, 'language': 'en',
            'metadata': {'model': 'faster-whisper/turbo', 'word_timestamps': True, 'timebase': 'seconds from start of complete audiobook', 'duration': duration,
                         'segment_count': len(rows), 'word_count': len(words), 'quality_passed': loops < 8, 'repeated_segment_run': loops,
                         'transcribe_seconds': round(took, 1), 'speed_x_realtime': round(duration / took, 1)}}


def process(job):
    cfg = job.cfg
    book_id = cfg['bookId']
    setup_tools()
    audio = download(job, cfg['audio'], W / 'in' / cfg['audio']['name'], 'download', 1, 12)
    epub = download(job, cfg['epub'], W / 'in' / cfg['epub']['name'], 'download', 12, 15)
    cover = download(job, cfg['cover'], W / 'in' / cfg['cover']['name'], 'download', 15, 16) if cfg.get('cover') else None

    import prepare_student_book as psb
    n_sections = len(psb.extract(Path(epub)))
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

    job.progress('align', 62, 'Matching the transcript to the ebook', force=True)
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

    markers = meta['markers']
    seg_dir = W / 'segments'; shutil.rmtree(seg_dir, ignore_errors=True); seg_dir.mkdir()
    for i, m in enumerate(markers):
        sh(['ffmpeg', '-v', 'error', '-y', '-ss', f'{m["start"]:.3f}', '-to', f'{m["end"]:.3f}', '-i', audio, '-map', '0:a:0', '-vn', '-c', 'copy', seg_dir / f'segment-{i:03d}.{ext}'])
        job.progress('split', 72 + 6 * (i + 1) / len(markers), f'Splitting the audio: chapter {i + 1} of {len(markers)}')
    files = sorted(seg_dir.glob('segment-*'))
    total = sum(float(json.loads(sh(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', f]).stdout)['format']['duration']) for f in files)
    want = markers[-1]['end'] - markers[0]['start']
    if abs(total - want) > max(3.0, len(files) * 0.15): raise RuntimeError(f'The split audio adds up to {total:.0f}s but the chapters cover {want:.0f}s.')

    key = f'reader/{book_id}/{meta["assetRevision"]}.json.gz'
    job.progress('upload', 79, 'Uploading the book', force=True)
    job.upload(key, out / f'{book_id}.reader.json.gz', 'application/gzip')
    for i, f in enumerate(files):
        job.upload(f'audio/{book_id}/{f.name}', f, CONTENT_TYPES.get(ext, 'application/octet-stream'), 'public, max-age=31536000, immutable')
        job.progress('upload', 79 + 18 * (i + 1) / len(files), f'Uploading audio: {i + 1} of {len(files)} chapters')
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
    result = {'bookId': book_id, 'coverage': st['coverage'], 'matchedWords': st['matched_words'], 'bookWords': st['book_words'], 'longestGuessedRun': run_len,
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
