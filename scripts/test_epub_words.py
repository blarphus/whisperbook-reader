import unittest
from bs4 import BeautifulSoup, NavigableString
from prepare_student_book import wrap_reader_words, transcript_section, interlace_transcript_sections, recover_compound_cues, BookWord, AsrWord, Match


def styled_characters(root):
    result=[]
    for text in root.find_all(string=True):
        chain=[]
        for p in text.parents:
            if p is root:break
            if p.name=='span' and 'word' in p.get('class',[]):continue
            chain.append((p.name,p.get('style','')))
        result.extend((char,tuple(chain)) for char in str(text))
    return result


class ReaderWordTests(unittest.TestCase):
    def check(self,html,expected):
        soup=BeautifulSoup(html,'html.parser');root=soup.div
        text=root.get_text();styles=styled_characters(root)
        words=wrap_reader_words(soup,root)
        self.assertEqual([w.text for w in words],expected)
        self.assertEqual(root.get_text(),text)
        self.assertEqual(styled_characters(root),styles)
        self.assertEqual([s['data-word'] for s in root.select('.word')],[str(i) for i in range(len(words))])
        return root,words

    def test_drop_cap_and_small_caps(self):
        self.check('<div><h1><span style="font-variant:small-caps">M</span>emories</h1><p><b>H</b>E went home.</p></div>', ['Memories','HE','went','home'])

    def test_nested_inline_word_and_punctuation(self):
        self.check('<div><p>“Un<em>be<strong>liev</strong>able</em>,” she said. Don<em>’t</em> go.</p></div>', ['Unbelievable','she','said','Don’t','go'])

    def test_pagebreak_processing_instructions_do_not_become_words(self):
        self.check('<div><p>First <?pagebreak number="93"?>page.</p><p><em>Next <?pagebreak number="94"?>page.</em></p></div>', ['First','page','Next','page'])

    def test_block_and_break_boundaries(self):
        root,words=self.check('<div><p>one</p><p>two<br/>three<img src="cover.jpg"/>four</p><blockquote><p>five</p></blockquote></div>', ['one','two','three','four','five'])
        self.assertEqual(root.img['src'],'cover.jpg')
        self.assertIsNotNone(root.br)
        self.assertNotEqual(words[0].paragraph,words[1].paragraph)

    def test_supplement_keeps_source_timing_and_escapes_text(self):
        words=[dict(word=' She',start=23.48,end=23.9),dict(word=' said,',start=24,end=24.2),dict(word=' “<Go>.”',start=24.3,end=25),dict(word=' Now.',start=26,end=26.5)]
        section=transcript_section('Opening passage',words)
        self.assertEqual(section['cues'],[[w['start'],w['end']] for w in words])
        self.assertEqual(section['sentences'],[[0,3],[3,4]])
        soup=BeautifulSoup(section['html'],'html.parser')
        self.assertEqual(soup.get_text(),''.join(w['word'] for w in words))
        self.assertIsNone(soup.find('go'))

    def test_supplement_rejects_regressing_timing(self):
        with self.assertRaisesRegex(AssertionError,'regress'):
            transcript_section('Opening passage',[dict(word='First',start=4,end=5),dict(word=' second',start=3,end=4)])

    def test_supplements_insert_in_audio_order_without_changing_epub_cues(self):
        a=transcript_section('First',[dict(word='Original.',start=5,end=6)])
        b=transcript_section('Second',[dict(word='Preserved.',start=20,end=21)])
        supplements=[transcript_section(title,[dict(word='Added.',start=t,end=t+1)]) for title,t in [('End',30),('Opening',1),('Between',10)]]
        chapters,cues=interlace_transcript_sections([a,b],[[5,6,'exact'],[20,21,'exact']],supplements)
        self.assertEqual([c['title'] for c in chapters],['Opening','First','Between','Second','End'])
        self.assertIs(chapters[1],a)
        self.assertIs(chapters[3],b)
        self.assertEqual(cues,[[1,2,'transcript'],[5,6,'exact'],[10,11,'transcript'],[20,21,'exact'],[30,31,'transcript']])

    def test_supplement_cannot_replace_overlapping_epub_narration(self):
        a=transcript_section('Original',[dict(word='One.',start=1,end=3)])
        b=transcript_section('Overlapping',[dict(word='Two.',start=2,end=4)])
        with self.assertRaisesRegex(AssertionError,'overlaps'):
            interlace_transcript_sections([a],[[1,3,'exact']],[b])

    def test_compound_recovery_uses_complete_source_intervals(self):
        words=[BookWord(w,w.replace('-',''),0) for w in ['a','well-tested','off-the-shelf','device']]
        texts=['a','well','tested','off','the','shelf','device']
        asr=[AsrWord(w,w,i,i+.8,.95) for i,w in enumerate(texts)]
        cues=[[0,.8,'exact',1],[1,2,'interpolated',0],[2,6,'interpolated',0],[6,6.8,'exact',1]]
        repairs=recover_compound_cues(words,asr,{0:Match(0,'exact',1),3:Match(6,'exact',1)},cues)
        self.assertEqual(len(repairs),2)
        self.assertEqual(cues[1][:2],[1,2.8])
        self.assertEqual(cues[2][:2],[3,5.8])

    def test_compound_recovery_never_splits_or_invents_source_words(self):
        words=[BookWord(w,w,0) for w in ['a','one','hundred','items']]
        asr=[AsrWord(w,w,i,i+.8,.95) for i,w in enumerate(['a','100','items'])]
        cues=[[0,.8,'exact',1],[1,1.5,'interpolated',0],[1.5,2,'interpolated',0],[2,2.8,'exact',1]]
        original=[c[:] for c in cues]
        self.assertEqual(recover_compound_cues(words,asr,{0:Match(0,'exact',1),3:Match(2,'exact',1)},cues),[])
        self.assertEqual(cues,original)


if __name__=='__main__':unittest.main()
