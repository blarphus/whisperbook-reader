// Deploy as the owner with anonymous access. Only listed prepared reader files are exposed.
// Source material remains in Google Drive. This endpoint does not cache or write files.
function doGet(e) {
  if (e && e.parameter && e.parameter.asset === 'audio') {
    return audioRange(e.parameter);
  }
  const books = {'the-martian': '1xQUCmbUvqd3o2NL5YASuRaE3gxj1AhE9'};
  const id = books[e && e.parameter && e.parameter.book];
  if (!id) {
    return ContentService.createTextOutput(JSON.stringify({error: 'Unknown book'}))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return ContentService.createTextOutput(
    DriveApp.getFileById(id).getBlob().getDataAsString('UTF-8')
  ).setMimeType(ContentService.MimeType.JSON);
}

function audioRange(parameters) {
  const files = {'the-martian': {id: '1qfXdR8rL6eK_1G5nLeTzO4UudNqvuslg', size: 169264860}};
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
