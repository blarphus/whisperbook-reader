// Deploy as the owner with anonymous access. Only listed prepared reader files are exposed.
// Source material remains in Google Drive. This endpoint does not cache or write files.
function doGet(e) {
  const books = {'the-martian': '1xQUCmbUvqd3o2NL5YASuRaE3gxj1AhE9'};
  const id = books[e.parameter.book];
  if (!id) {
    return ContentService.createTextOutput(JSON.stringify({error: 'Unknown book'}))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return ContentService.createTextOutput(
    DriveApp.getFileById(id).getBlob().getDataAsString('UTF-8')
  ).setMimeType(ContentService.MimeType.JSON);
}
