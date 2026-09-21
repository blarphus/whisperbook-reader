// Custom domain on the whisperbook-audio R2 bucket (the pub-*.r2.dev address is rate-limited and often filtered).
export const r2Origin = 'https://media.studentbookreader.com';
export const r2AudioBase = `${r2Origin}/audio`;
export const preparedKeys: Record<string, string> = {
  'dungeon-crawler-carl': 'reader/dungeon-crawler-carl/9d81f65a2e919ff9.json.gz',
  'the-car': 'reader/the-car/ba6e681221fdc09f.json.gz',
  scythe: 'reader/scythe/9733a8978974a4a0.json.gz',
  eragon: 'reader/eragon/ec7bc005affa9706.json.gz',
  'project-hail-mary': 'reader/project-hail-mary/68b9fec9c03a758c.json.gz',
  'just-mercy': 'reader/just-mercy/33d4cd41cb96b1b8.json.gz',
  'the-martian': 'reader/the-martian/ef2cdba97a67b661.json.gz',
  'one-of-us-is-lying': 'reader/one-of-us-is-lying/fedb15be918f5bbb.json.gz',
  'the-maze-runner': 'reader/the-maze-runner/ce074692e8d79e54.json.gz',
  'bad-beginning': 'reader/bad-beginning/f04c9f0088fddc1e0a75d2d73e5807e1.json.gz',
  'harry-potter': 'reader/harry-potter/55c41fe4114ab5a4fb048a3806de8ea2.json.gz',
  'the-lightning-thief': 'reader/the-lightning-thief/7e920cb4c2ccba7c.json.gz',
};
export const r2Books:Record<string,{extension:string}>={
  'dungeon-crawler-carl':{extension:'m4a'},'the-car':{extension:'m4a'},scythe:{extension:'mp3'},eragon:{extension:'m4a'},
  'project-hail-mary':{extension:'m4a'},'just-mercy':{extension:'m4a'},
  'the-martian':{extension:'m4a'},'one-of-us-is-lying':{extension:'m4a'},
  'the-maze-runner':{extension:'mp3'},'bad-beginning':{extension:'m4a'},'harry-potter':{extension:'opus'},'the-lightning-thief':{extension:'opus'},
};

// Reader packages are served through our own Worker (same origin, no CORS); the Worker reads them from R2 server-side.
export function readerURL(book: string, asset: string) {
  return asset === 'prepared' ? `/api/book/prepared?book=${encodeURIComponent(book)}` : '';
}
