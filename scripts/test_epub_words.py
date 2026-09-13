import unittest
from bs4 import BeautifulSoup, NavigableString
from prepare_student_book import wrap_reader_words, transcript_section


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


if __name__=='__main__':unittest.main()
