// Deploy as the owner with anonymous access. Only listed readers and audio ranges are exposed.
// Source material remains in Google Drive. This endpoint does not cache or write files.
function doGet(e) {
  if (e && e.parameter && e.parameter.asset === 'audio') {
    return audioRange(e.parameter);
  }
  const books = {
    'dungeon-crawler-carl': '1WWTZyxBz9YYbDf7Y6hfRhauYR8erUYLT',
    'the-car': '1WpJgogtvI0t6d7GU7vgfTQsVTwZvKvr-',
    'scythe': '1w71H201njkS8eGBxxKfKuXh9yBaQTtYG',
    'eragon': '1F6u0OWPWrJenembohmY-2FFVAI0_k4i0',
    'project-hail-mary': '1TDYNIIX78ohGncIHZVtFd1WEORB9ooCU',
    'just-mercy': '1ScJgBpD5YDCkha2H--FcUn8hzZ8-3wAT',
    'the-martian': '1xQUCmbUvqd3o2NL5YASuRaE3gxj1AhE9'
  };
  const book = e && e.parameter && e.parameter.book;
  const id = books[book];
  if (!id) {
    return ContentService.createTextOutput(JSON.stringify({error: 'Unknown book'}))
      .setMimeType(ContentService.MimeType.JSON);
  }
  let blob = DriveApp.getFileById(id).getBlob();
  if (book !== 'the-martian') blob = Utilities.ungzip(blob);
  return ContentService.createTextOutput(blob.getDataAsString('UTF-8'))
    .setMimeType(ContentService.MimeType.JSON);
}

function audioRange(parameters) {
  const files = {
    'dungeon-crawler-carl': {id: '10_SYUSwZwMzUae3YVZ4qQr-HKFX-cf_a', size: 773787995},
    'the-car': {id: '1pjIxN4uISRCEVRjKIXwYY_wag9x9W7pi', size: 123387948},
    'scythe': {id: '1-zyKxmuFsuB9T078xNuTEdV3qDOGPNiE', size: 189822576},
    'eragon': {id: '1RF-J7mzZoG3AJzHM2dj9resgIs5rXrbW', size: 937347313},
    'project-hail-mary': {id: '19EBL2jgPQF6DFpTCVEjo9An99wgqI94L', size: 924595694},
    'just-mercy': {id: '1Sp-XYQWbs0g6iOjQpl0hpg7Lo_Q12SyW', size: 189060663},
    'the-martian': {id: '1qfXdR8rL6eK_1G5nLeTzO4UudNqvuslg', size: 169264860}
  };
  const file = files[parameters.book];
  const start = Number(parameters.start), end = Number(parameters.end);
  if (!file || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
      start < 0 || end < start || end >= file.size || end-start >= 1048576) {
    return jsonOutput({error: 'Invalid audio range'});
  }
  const response = UrlFetchApp.fetch(
    'https://www.googleapis.com/drive/v3/files/' + file.id + '?alt=media',
    {headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
      Range: 'bytes=' + start + '-' + end}, muteHttpExceptions: true}
  );
  const bytes = response.getContent();
  if (response.getResponseCode() !== 206 || bytes.length !== end-start+1) {
    return jsonOutput({error: 'Drive could not stream the requested audio range',
      status: response.getResponseCode()});
  }
  return jsonOutput({start: start, end: end, total: file.size,
    data: Utilities.base64Encode(bytes)});
}

function jsonOutput(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function verifyReaderData() {
  const text = DriveApp.getFileById('1xQUCmbUvqd3o2NL5YASuRaE3gxj1AhE9')
    .getBlob().getDataAsString('UTF-8');
  const reader = JSON.parse(text);
  console.log('Reader JSON verified, characters ' + text.length +
    ', fields ' + Object.keys(reader).join(', '));
}

// Editor-only diagnostic. The deployed reader endpoint never exposes the token.
function verifyDriveAudio() {
  const result = UrlFetchApp.fetch(
    'https://www.googleapis.com/drive/v3/files/1qfXdR8rL6eK_1G5nLeTzO4UudNqvuslg?alt=media',
    {headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
      Range: 'bytes=0-65535'}, muteHttpExceptions: true}
  );
  const status = result.getResponseCode();
  console.log('Audio range status ' + status + ', bytes ' + result.getContent().length);
  if (status !== 206) console.log(result.getContentText().slice(0, 500));
}
