import json,gzip,hashlib,re
from pathlib import Path
from bs4 import BeautifulSoup
root=Path(__file__).resolve().parents[2]
book=root/'Dungeon Crawler Carl'; out=book/'Website';out.mkdir(exist_ok=True)
config=json.loads((book/'Video/whole-book/config.json').read_text())
chapters=[]
for jobpath in config['jobs']:
 job=json.loads(Path(jobpath).read_text()); soup=BeautifulSoup(Path(job['html']).read_text(),'html.parser');article=soup.select_one('#book');spans=article.select('span.word'); sentences=[];start=0
 for i,span in enumerate(spans):
  nxt=spans[i+1] if i+1<len(spans) else None
  block=span.find_parent(['p','li','blockquote','h1','h2','h3'])
  between=''
  if nxt:
   for e in span.next_elements:
    if e is nxt:break
    if isinstance(e,str) and e.parent is not span:between+=str(e)
  boundary=nxt is None or block is not nxt.find_parent(['p','li','blockquote','h1','h2','h3'])
  token=span.get_text().lower()
  boundary=boundary or bool(re.search(r'[!?]',between)) or ('.' in between and token not in ['mr','mrs','ms','dr','prof','rev','st','jr','sr','vs','etc','eg','ie','no','fig'] and not re.fullmatch('[A-Z]',span.get_text()))
  if boundary:sentences.append([start,i+1]);start=i+1
 assert len(spans)==len(job['cues'])
 chapters.append(dict(title=job['chapter']['title'],html=article.decode_contents(),cues=[[c['start'],c['end']] for c in job['cues']],sentences=sentences,start=job['sourceStart'],end=job['sourceEnd']))
data=dict(version=1,id='dungeon-crawler-carl',title='Dungeon Crawler Carl',author='Matt Dinniman',duration=config['sourceDuration'],introEnd=17.320998,creditsStart=48558.683492,chapters=chapters,markers=[dict(title=c['title'],start=round(c['start']*config['rate'],6),end=round(c['end']*config['rate'],6)) for c in config['chapters']])
raw=json.dumps(data,separators=(',',':'),ensure_ascii=False).encode();dest=out/'dungeon-crawler-carl.reader.json.gz';dest.write_bytes(gzip.compress(raw,mtime=0))
meta={k:v for k,v in data.items() if k!='chapters'};meta['chapters']=[{k:c[k] for k in ['title','start','end']} for c in chapters]
(root/'ReaderWebsite/lib/book.json').write_text(json.dumps(meta))
(out/'preparation-report.json').write_text(json.dumps(dict(words=sum(len(c['cues']) for c in chapters),chapters=len(chapters),sentences=sum(len(c['sentences']) for c in chapters),bytes=len(raw),compressedBytes=dest.stat().st_size,sha256=hashlib.sha256(raw).hexdigest()),indent=2))
print((out/'preparation-report.json').read_text())
