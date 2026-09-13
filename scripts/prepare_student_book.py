"""Prepare EPUB text and permanent audiobook cues once, before website import."""
from __future__ import annotations
import argparse, base64, copy, gzip, hashlib, html, json, mimetypes, posixpath, re, sys, zipfile
from pathlib import Path
from bs4 import BeautifulSoup, NavigableString, Comment
from lxml import etree
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from prepare_whispersync import (WORD_RE, BookWord, AsrWord, Match, normalize_word, align_words,
    build_cues, parse_epub_navigation, trim_before, trim_after)

BLOCKS=['p','li','blockquote','h1','h2','h3','h4','h5','h6']
PROPERTIES={'font-style','font-weight','font-variant','text-align','text-indent','text-decoration','vertical-align'}

def wrap_reader_words(soup, root):
    """Wrap lexical words across inline formatting without splitting their cues."""
    inline={'span','em','strong','b','i','u','s','small','sup','sub','a','abbr','code'}
    words=[]
    blockmap={id(node):i for i,node in enumerate(root.find_all(BLOCKS))}

    def slice_node(node, left, right):
        if isinstance(node, NavigableString):
            return NavigableString(str(node)[left:right])
        result=soup.new_tag(node.name, attrs=copy.deepcopy(node.attrs))
        offset=0
        for child in node.contents:
            length=len(child.get_text() if not isinstance(child,NavigableString) else str(child))
            if left<offset+length and right>offset:
                result.append(slice_node(child,max(0,left-offset),min(length,right-offset)))
            offset+=length
        return result

    def process(parent):
        children=list(parent.contents)
        output=[];run=[]
        def flush():
            if not run:return
            text=''.join(n.get_text() if not isinstance(n,NavigableString) else str(n) for n in run)
            offsets=[];offset=0
            for node in run:
                length=len(node.get_text() if not isinstance(node,NavigableString) else str(node))
                offsets.append((node,offset,offset+length));offset+=length
            def fragments(left,right):
                return [slice_node(n,max(0,left-a),min(b-a,right-a)) for n,a,b in offsets if left<b and right>a]
            cursor=0
            for match in WORD_RE.finditer(text):
                output.extend(fragments(cursor,match.start()))
                span=soup.new_tag('span',attrs={'class':'word','data-word':str(len(words))})
                for part in fragments(match.start(),match.end()):span.append(part)
                block=parent if parent.name in BLOCKS else parent.find_parent(BLOCKS)
                words.append(BookWord(match.group(),normalize_word(match.group()),blockmap.get(id(block),0)))
                output.append(span);cursor=match.end()
            output.extend(fragments(cursor,len(text)));run.clear()
        for node in children:
            if isinstance(node,Comment):continue
            # Images and line breaks terminate a run, including when nested in a span.
            is_inline=not isinstance(node,NavigableString) and node.name in inline and all(t.name in inline for t in node.find_all(True))
            if isinstance(node,NavigableString) or is_inline:run.append(node)
            else:
                flush();process(node);output.append(node)
        flush()
        parent.clear()
        for node in output:parent.append(node)
    original=root.get_text()
    process(root)
    assert root.get_text()==original, 'Text changed while wrapping words'
    assert [n.get_text() for n in root.select('.word')]==[w.text for w in words]
    return words

def transcript_section(title, words):
    """Use reviewed recording words and their original timestamps directly."""
    pieces=[];cues=[];sentences=[];sentence_start=0
    for word in words:
        raw=word['word'];text=raw.strip()
        if not normalize_word(text):
            pieces.append(html.escape(raw));continue
        start,end=float(word['start']),float(word['end'])
        assert 0<=start<end, 'Invalid transcript word interval'
        assert not cues or start>=cues[-1][0], 'Transcript timestamps regress'
        prefix=raw[:len(raw)-len(raw.lstrip())]
        suffix=raw[len(raw.rstrip()):]
        pieces.append(html.escape(prefix)+f'<span class="word" data-word="{len(cues)}">'+html.escape(text)+'</span>'+html.escape(suffix))
        cues.append([start,end])
        if re.search(r'[.!?][”\"\u2019\']*$',text) and text.lower().rstrip('.') not in {'mr','mrs','ms','dr','prof','rev','st','jr','sr'}:
            sentences.append([sentence_start,len(cues)]);sentence_start=len(cues)
    assert cues, 'Transcript supplement has no timed words'
    if sentence_start<len(cues):sentences.append([sentence_start,len(cues)])
    return dict(title=title,html='<div class="chapter-text"><p>'+''.join(pieces)+'</p></div>',cues=cues,sentences=sentences,start=cues[0][0],end=cues[-1][1])

def write_opening_reader_epub(source, destination, supplements, before_resource):
    """Insert reviewed opening pages while retaining all original EPUB resources."""
    with zipfile.ZipFile(source) as archive:
        container=etree.fromstring(archive.read('META-INF/container.xml'))
        opf=container.xpath("//*[local-name()='rootfile']/@full-path")[0]
        package=etree.fromstring(archive.read(opf));base=posixpath.dirname(opf)
        manifest=package.xpath("//*[local-name()='manifest']")[0]
        spine=package.xpath("//*[local-name()='spine']")[0]
        target=next(x for x in manifest if posixpath.normpath(posixpath.join(base,x.get('href','')))==before_resource)
        reference=next(x for x in spine if x.get('idref')==target.get('id'))
        insertion=spine.index(reference);new_files={};entries=[]
        ns=etree.QName(manifest).namespace
        for i,section in enumerate(supplements):
            identifier=f'whisperbook-opening-{i+1}';href=f'whisperbook/{identifier}.xhtml'
            assert not any(x.get('id')==identifier for x in manifest), 'Supplement ID collision'
            item=etree.SubElement(manifest,f'{{{ns}}}item',id=identifier,href=href)
            item.set('media-type','application/xhtml+xml')
            spine.insert(insertion+i,etree.Element(f'{{{ns}}}itemref',idref=identifier))
            resource=posixpath.join(base,href)
            content='<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>'+html.escape(section['title'])+'</title></head><body>'+section['html']+'</body></html>'
            etree.fromstring(content.encode())
            new_files[resource]=content.encode();entries.append((section['title'],resource,identifier))
        for item in manifest:
            if item.get('media-type')=='application/x-dtbncx+xml':
                path=posixpath.normpath(posixpath.join(base,item.get('href')))
                doc=etree.fromstring(archive.read(path));nav=doc.xpath("//*[local-name()='navMap']")[0]
                target_point=next(n for n in nav.iter() if etree.QName(n).localname=='navPoint' and any(posixpath.normpath(posixpath.join(posixpath.dirname(path),c.get('src','').split('#')[0]))==before_resource for c in n if etree.QName(c).localname=='content'))
                parent=target_point.getparent();offset=parent.index(target_point);ncxns=etree.QName(nav).namespace
                for i,(title,resource,identifier) in enumerate(entries):
                    point=etree.Element(f'{{{ncxns}}}navPoint',id=identifier)
                    label=etree.SubElement(point,f'{{{ncxns}}}navLabel');etree.SubElement(label,f'{{{ncxns}}}text').text=title
                    etree.SubElement(point,f'{{{ncxns}}}content',src=posixpath.relpath(resource,posixpath.dirname(path)))
                    parent.insert(offset+i,point)
                for i,point in enumerate(doc.xpath("//*[local-name()='navPoint']"),1):point.set('playOrder',str(i))
                new_files[path]=etree.tostring(doc,xml_declaration=True,encoding='utf-8')
            if 'nav' in item.get('properties','').split():
                path=posixpath.normpath(posixpath.join(base,item.get('href')))
                doc=etree.fromstring(archive.read(path))
                anchors=doc.xpath("//*[local-name()='nav' and contains(@*[local-name()='type'],'toc')]//*[local-name()='a']")
                anchor=next(a for a in anchors if posixpath.normpath(posixpath.join(posixpath.dirname(path),a.get('href','').split('#')[0]))==before_resource)
                li=anchor.getparent();parent=li.getparent();offset=parent.index(li);xns=etree.QName(li).namespace
                for i,(title,resource,_) in enumerate(entries):
                    entry=etree.Element(f'{{{xns}}}li');etree.SubElement(entry,f'{{{xns}}}a',href=posixpath.relpath(resource,posixpath.dirname(path))).text=title
                    parent.insert(offset+i,entry)
                new_files[path]=etree.tostring(doc,xml_declaration=True,encoding='utf-8')
        new_files[opf]=etree.tostring(package,xml_declaration=True,encoding='utf-8')
        assert Path(source).resolve()!=Path(destination).resolve(), 'Original EPUB must be preserved'
        with zipfile.ZipFile(destination,'w') as target_archive:
            for item in archive.infolist():target_archive.writestr(item,new_files.pop(item.filename,archive.read(item.filename)))
            for name,data in new_files.items():target_archive.writestr(name,data,compress_type=zipfile.ZIP_DEFLATED)

def extract(epub:Path):
    sections=[]
    with zipfile.ZipFile(epub) as archive:
        container=etree.fromstring(archive.read('META-INF/container.xml'))
        opf=container.xpath("//*[local-name()='rootfile']/@full-path")[0]
        package=etree.fromstring(archive.read(opf))
        nav,spine,_=parse_epub_navigation(archive,opf,package)
        for index,entry in enumerate(nav):
            resource,_,fragment=entry.href.partition('#')
            resource=posixpath.normpath(resource)
            following=nav[index+1] if index+1<len(nav) else None
            endfile,_,endfragment=following.href.partition('#') if following else ('','','')
            endfile=posixpath.normpath(endfile) if endfile else ''
            first=spine.index(resource)
            last=spine.index(endfile) if endfile in spine else len(spine)
            paths=[resource] if endfile==resource else spine[first:last+(1 if endfragment else 0)]
            soup=BeautifulSoup('<div class="chapter-text"></div>','html.parser');root=soup.div
            resources=[]
            for path in paths:
                doc=etree.fromstring(archive.read(path),etree.XMLParser(recover=True))
                body=copy.deepcopy(doc.xpath("//*[local-name()='body']")[0])
                if path==resource and fragment:trim_before(body,fragment)
                if path==endfile and endfragment:
                    if body.get('id')==endfragment or body.get('name')==endfragment:continue
                    trim_after(body,endfragment)
                for node in body.iter():
                    if isinstance(node.tag,str):node.tag=etree.QName(node).localname
                etree.cleanup_namespaces(body)
                part=BeautifulSoup(etree.tostring(body,encoding='unicode',method='html'),'html.parser')
                stylemap={}
                css=[]
                for link in doc.xpath("//*[local-name()='link' and @rel='stylesheet']/@href"):
                    csspath=posixpath.normpath(posixpath.join(posixpath.dirname(path),link))
                    if csspath in archive.namelist():css.append(archive.read(csspath).decode('utf8'))
                for stylesheet in css:
                    for selector,bodycss in re.findall(r'([^{}]+)\{([^{}]*)\}',re.sub(r'/\*.*?\*/','',stylesheet,flags=re.S)):
                        if selector.strip().startswith('@'):continue
                        props={k.strip():v.strip() for k,v in re.findall(r'([\w-]+)\s*:\s*([^;]+)',bodycss) if k.strip() in PROPERTIES and not re.search(r'url\(|expression',v,re.I)}
                        if not props:continue
                        try:nodes=part.select(selector.strip())
                        except Exception:continue
                        for node in nodes:stylemap.setdefault(id(node),{}).update(props)
                for node in list(part.find_all(True)):
                    if node.name in ['script','style','iframe','object','embed','form','audio','video']:
                        node.decompose();continue
                    props=stylemap.get(id(node),{}).copy()
                    for k,v in re.findall(r'([\w-]+)\s*:\s*([^;]+)',node.get('style','')):
                        if k.strip() in PROPERTIES and not re.search(r'url\(|expression',v,re.I):props[k.strip()]=v.strip()
                    attrs={}
                    if props:attrs['style']=';'.join(k+':'+v for k,v in props.items())
                    if node.name=='img':
                        source=posixpath.normpath(posixpath.join(posixpath.dirname(path),node.get('src','')))
                        if source in archive.namelist():
                            data=archive.read(source);mime=mimetypes.guess_type(source)[0] or 'image/jpeg'
                            attrs.update(src='data:'+mime+';base64,'+base64.b64encode(data).decode(),alt=node.get('alt',''))
                        else:raise ValueError('Missing EPUB image '+source)
                    node.attrs=attrs
                resources.append(path)
                for child in list(part.body.contents):root.append(child.extract())
            original=root.get_text()
            words=wrap_reader_words(soup,root)
            assert root.get_text()==original, 'Text changed while wrapping words'
            assert [n.get_text() for n in root.select('.word')]==[w.text for w in words]
            sentences=[];start=0;spans=root.select('.word')
            for i,span in enumerate(spans):
                nxt=spans[i+1] if i+1<len(spans) else None
                between=''
                for element in span.next_elements:
                    if element is nxt:break
                    if isinstance(element,NavigableString) and element.parent is not span:between+=str(element)
                boundary=nxt is None or span.find_parent(BLOCKS) is not nxt.find_parent(BLOCKS)
                boundary=boundary or bool(re.search(r'[!?]',between)) or ('.' in between and span.get_text().lower() not in ['mr','mrs','ms','dr','prof','rev','st','jr','sr','vs','etc'] and not re.fullmatch('[A-Z]',span.get_text()))
                if boundary:sentences.append([start,i+1]);start=i+1
            sections.append(dict(title=entry.label,resources=resources,html=str(root),words=[w.__dict__ for w in words],sentences=sentences))
    return sections


def prepare_alignment(book,sections,transcript,probe,output):
    body_ranges={'the-car':(3,32),'just-mercy':(5,23),'eragon':(5,65),'scythe':(2,47),'the-martian':(3,29),'project-hail-mary':(4,34)}
    left,right=body_ranges[book['id']]
    indices=book.get('readerSectionIndices',list(range(left,right)))
    assert len(set(indices))==len(indices) and all(0<=i<len(sections) for i in indices), 'Invalid reader section order'
    selected=[sections[i] for i in indices]
    words=[BookWord(**word) for section in selected for word in section['words']]
    raw=gzip.decompress(transcript.read_bytes()) if transcript.suffix=='.gz' else transcript.read_bytes()
    payload=json.loads(raw)
    assert abs(payload['metadata']['duration']-book['duration'])<.1, 'Transcript audio duration mismatch'
    raw_words=payload.get('words') or [w for seg in payload['segments'] for w in seg['words']]
    asr=[AsrWord(w['word'],normalize_word(w['word']),w['start'],w['end'],w.get('probability',1)) for w in raw_words if normalize_word(w['word'])]
    assert all(a.start<=b.start for a,b in zip(asr,asr[1:])), 'Transcript timestamps regress'
    mapped,stats=align_words(words,asr)
    # Recover reviewed spelling variants only when both neighboring EPUB words
    # already anchor a single ASR word. Never rewrite the EPUB or transcript.
    alias_matches=[]
    aliases={normalize_word(k):{normalize_word(v) for v in values}
             for k,values in book.get('reviewedTranscriptAliases',{}).items()}
    for i,word in enumerate(words):
        if i in mapped or word.norm not in aliases or i-1 not in mapped or i+1 not in mapped:
            continue
        left=mapped[i-1].asr_index;right=mapped[i+1].asr_index
        if right==left+2 and asr[left+1].norm in aliases[word.norm]:
            mapped[i]=Match(left+1,'reviewed-alias',1.0)
            alias_matches.append(dict(word=i,epub=word.text,transcript=asr[left+1].text,
                                      start=asr[left+1].start,end=asr[left+1].end))
    stats['matched_words']+=len(alias_matches)
    stats['reviewed_alias_matches']=len(alias_matches)
    cues,cue_stats=build_cues(words,asr,mapped,book['duration'])
    # Printed chapter numerals can be separate spoken number words in the ASR.
    # Match only inside the already-anchored gap before the first prose word.
    number_names=['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen']
    tens=['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety']
    heading_repairs=[];offset=0
    for section in selected:
        title=section['title'];count=len(section['words'])
        heading_number=title if title.isdigit() else (re.match(r'^Chapter\s+(\d+)\b',title).group(1) if re.match(r'^Chapter\s+(\d+)\b',title) else None)
        if heading_number and 0<int(heading_number)<100 and count>1 and section['words'][0]['text']==heading_number:
            value=int(heading_number);spoken=number_names[value] if value<20 else tens[value//10]+(' '+number_names[value%10] if value%10 else '')
            candidates=[];low=cues[offset][0];high=cues[offset+1][0]
            for i,w in enumerate(asr):
                if not low<=w.start<high:continue
                for length in [1,2]:
                    chunk=asr[i:i+length]
                    if len(chunk)!=length or chunk[-1].end>high:continue
                    phrase=' '.join(x.norm for x in chunk).replace('-',' ')
                    if phrase in {spoken,heading_number}:candidates.append(chunk)
            if len(candidates)==1:
                chunk=candidates[0];previous=cues[offset]
                cues[offset]=[chunk[0].start,chunk[-1].end,'spoken-heading',min(w.probability for w in chunk)]
                heading_repairs.append(dict(title=title,previous=previous[:2],verified=cues[offset][:2],transcript=' '.join(w.text.strip() for w in chunk)))
                if previous[2]=='interpolated':stats['matched_words']+=1
        offset+=count
    stats['coverage']=stats['matched_words']/len(words)
    stats['spoken_heading_matches']=len(heading_repairs)
    timing_repairs=[]
    if book.get('reviewedCueRepairs'):
        repairs=json.loads(Path(book['reviewedCueRepairs']).read_text())
        assert repairs.get('reviewed') is True, 'Timing repairs require review'
        assert repairs['sourceAudioSha256']==book['sha256'], 'Timing repair recording changed'
        offsets={};offset=0
        for section in selected:
            offsets[section['title']]=offset;offset+=len(section['words'])
        for repair in repairs['repairs']:
            section=next(s for s in selected if s['title']==repair['section'])
            first=repair['startWord'];fixed=repair['words'];last=first+len(fixed)
            assert [normalize_word(w['word']) for w in fixed]==[w['norm'] for w in section['words'][first:last]], 'Timing repair text changed'
            begin=offsets[repair['section']]+first
            assert all(w['start']<w['end'] for w in fixed)
            assert all(a['end']<=b['start'] for a,b in zip(fixed,fixed[1:])), 'Timing repairs overlap'
            assert begin==0 or fixed[0]['start']>=cues[begin-1][0]
            assert begin+len(fixed)==len(cues) or fixed[-1]['end']<=cues[begin+len(fixed)][0]
            for i,w in enumerate(fixed,begin):
                if cues[i][2]=='interpolated':stats['matched_words']+=1
                cues[i]=[w['start'],w['end'],'forced-alignment',w.get('probability',1)]
            timing_repairs.append(dict(section=repair['section'],startWord=first,words=len(fixed),method=repair['method']))
        stats['coverage']=stats['matched_words']/len(words)
    run=longest=0
    for cue in cues:
        run=run+1 if cue[2]=='interpolated' else 0
        longest=max(longest,run)
    cue_stats['longest_interpolated_run']=longest
    cursor=0;chapters=[];reviews=[]
    for index,section in enumerate(selected):
        count=len(section['words']);local=cues[cursor:cursor+count]
        if not local:raise ValueError('Empty reading section '+section['title'])
        matched=sum(c[2]!='interpolated' for c in local)
        report=dict(title=section['title'],wordCount=count,matched=matched,coverage=matched/count,start=local[0][0],end=local[-1][1],unmatched=[])
        start=None
        for i in range(count+1):
            missing=i<count and local[i][2]=='interpolated'
            if missing and start is None:start=i
            if not missing and start is not None:
                report['unmatched'].append(dict(startWord=start,endWord=i,start=local[start][0],end=local[i-1][1],text=' '.join(w['text'] for w in section['words'][start:i])))
                start=None
        reviews.append(report)
        chapters.append(dict(title=section['title'],html=section['html'],cues=[c[:2] for c in local],sentences=section['sentences'],start=local[0][0],end=local[-1][1]))
        cursor+=count
    for chapter in chapters:
        if chapter['title'] in book.get('reviewedUnspokenSections',[]):
            chapter['spoken']=False
    supplements=[]
    if book.get('readerSupplements'):
        supplement_path=Path(book['readerSupplements'])
        supplement_data=json.loads(supplement_path.read_text())
        assert supplement_data.get('reviewed') is True, 'Unreviewed transcript supplement'
        assert supplement_data['sourceTranscriptSha256']==hashlib.sha256(raw).hexdigest(), 'Supplement transcript changed after review'
        assert supplement_data['sourceAudioSha256']==book['sha256'], 'Supplement recording mismatch'
        for item in supplement_data['sections']:
            section=transcript_section(item['title'],item['words'])
            assert section['end']<=chapters[0]['start'], 'Opening supplement overlaps EPUB narration'
            supplements.append(section)
        supplements.sort(key=lambda c:c['start'])
        assert all(a['end']<=b['start'] for a,b in zip(supplements,supplements[1:])), 'Supplements overlap'
        chapters=supplements+chapters
        cues=[[a,b,'transcript'] for s in supplements for a,b in s['cues']]+cues
        write_opening_reader_epub(Path(book['epub']),output/(book['title']+' - Reader Edition.epub'),supplements,selected[0]['resources'][0])
    for a,b in zip(chapters,chapters[1:]):a['end']=b['start']
    markers=[dict(title=c['tags']['title'],start=float(c['start_time']),end=float(c['end_time'])) for c in probe.get('chapters',[])]
    credits=next((m['start'] for m in markers if 'closing credit' in m['title'].lower() or 'end credit' in m['title'].lower()),book['duration'])
    credits=book.get('verifiedCreditsStart',credits)
    assert chapters[-1]['cues'][-1][1]<=credits<=book['duration'], 'Credits overlap narrated prose'
    chapters[-1]['end']=credits
    data=dict(audioOnlyIntroduction=False,version=1,id=book['id'],title=book['title'],author=book['author'],duration=book['duration'],introEnd=chapters[0]['start'],creditsStart=credits,chapters=chapters,markers=markers)
    report=dict(stats=stats,cues=cue_stats,sections=reviews,sourceTranscriptQuality=payload['metadata'].get('quality_passed'),status='Review required before import')
    report['transcriptSupplements']=[dict(title=s['title'],words=len(s['cues']),start=s['start'],end=s['end']) for s in supplements]
    report['spokenHeadingRepairs']=heading_repairs
    report['reviewedAliasMatches']=alias_matches
    report['reviewedTimingRepairs']=timing_repairs
    (output/'alignment-review.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    (output/(book['id']+'.alignment.json')).write_text(json.dumps(dict(book=book['id'],timebase='seconds from start of source audiobook',cues=cues,stats=stats),ensure_ascii=False))
    packed=json.dumps(data,ensure_ascii=False,separators=(',',':')).encode()
    (output/(book['id']+'.reader.json.gz')).write_bytes(gzip.compress(packed,mtime=0))
    metadata={k:v for k,v in data.items() if k!='chapters'};metadata['chapters']=[{k:c[k] for k in ['title','start','end']} for c in chapters]
    metadata['assetRevision']=hashlib.sha256(packed).hexdigest()[:16]
    (output/'book-metadata.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2))
    print('Prepared draft alignment',book['id'],stats,'Review',output/'alignment-review.json')

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--manifest',type=Path,required=True);parser.add_argument('--book',required=True);parser.add_argument('--transcript',type=Path);args=parser.parse_args()
    book=next(b for b in json.loads(args.manifest.read_text()) if b['id']==args.book)
    output=Path(book['audio']).parent/'Website';output.mkdir(exist_ok=True)
    sections=extract(Path(book.get('readerEPUB',book['epub'])))
    (output/'epub-sections.json').write_text(json.dumps(sections,ensure_ascii=False))
    (output/'epub-extraction-report.json').write_text(json.dumps([dict(title=s['title'],resources=s['resources'],words=len(s['words']),sentences=len(s['sentences'])) for s in sections],indent=2))
    print('Extracted',len(sections),'sections with verified text order for',args.book)
    if args.transcript:
        probe_path=Path(book['chapterProbe']) if book.get('chapterProbe') else args.manifest.parent/(book['id']+'-playable-probe.json')
        probe=json.loads(probe_path.read_text())
        prepare_alignment(book,sections,args.transcript,probe,output)
if __name__=='__main__':main()
