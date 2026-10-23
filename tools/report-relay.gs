/* OverBoard board reports: the relay.
   Runs as a Google Apps Script web app under the reports Gmail account (setup: docs/REPORTS.md).
   app/report/ posts a report here when someone presses Send. This script:
     1. opens a GitHub issue with the board details and the touch data (label "board-report"), and
     2. emails the whole report to the reports inbox, with the person's email and comments.
   The person's email and comments are never put in the public issue.

   Script properties (Project Settings ▸ Script properties):
     GITHUB_TOKEN   a fine-grained GitHub token: this repository only, Issues: read and write
     GITHUB_REPO    BPMData/OverBoard
     NOTIFY_EMAIL   (optional) where to email reports; leave it out to use this Google account's own inbox
*/

var MAX_CHARS = 300000;    // a report is usually 20-60 KB; refuse anything far bigger
var MAX_PER_HOUR = 20;     // more than this in one hour is a robot, not teachers
var ISSUE_LIMIT = 60000;   // GitHub allows 65,536 characters in an issue body

function doPost(e) {
  try {
    var text = (e && e.postData && e.postData.contents) || '';
    if (text.length > MAX_CHARS) return reply({ ok: false, error: 'too big' });
    var r = JSON.parse(text);
    if (!r || r.app !== 'OverBoard' || r.kind !== 'board-report') return reply({ ok: false, error: 'not a report' });
    if (r.website) return reply({ ok: true });   // the hidden "leave this empty" box was filled in: a robot. Pretend it worked.
    if (!underLimit()) return reply({ ok: false, error: 'busy' });

    var priv = r['private'] || {};
    delete r['private']; delete r.website;
    var props = PropertiesService.getScriptProperties();
    var issue = null, issueError = '';
    try { issue = openIssue(r, props); } catch (err) { issueError = String(err).slice(0, 500); }
    emailReport(r, priv, issue, issueError, props);
    return reply({ ok: true, issue: issue ? issue.number : null, url: issue ? issue.html_url : null });
  } catch (err) {
    return reply({ ok: false, error: String(err).slice(0, 200) });
  }
}

function doGet() { return reply({ ok: true, hello: 'OverBoard report relay' }); }

function reply(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function underLimit() {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var cache = CacheService.getScriptCache(), key = 'sent-' + Math.floor(Date.now() / 3600000);
    var n = Number(cache.get(key) || 0);
    if (n >= MAX_PER_HOUR) return false;
    cache.put(key, String(n + 1), 3700);
    return true;
  } finally { lock.releaseLock(); }
}

/* ---------- plain words ---------- */
var BRANDS = { smart: 'SMART', promethean: 'Promethean', viewsonic: 'ViewSonic', benq: 'BenQ', newline: 'Newline', clevertouch: 'Clevertouch',
  boxlight: 'Boxlight / Mimio', samsung: 'Samsung Flip', 'surface-hub': 'Microsoft Surface Hub', projector: 'Projector', laptop: 'Laptop or tablet touch screen',
  other: 'Other', unknown: "Doesn't know" };
var STEP_NAMES = { finger: 'Finger', pen: 'Pen', palm: 'Hand (palm wipe)', eraser: "Board's eraser", two: 'Two fingers' };

/* text people typed goes into a public issue: keep it plain (no links, @mentions, HTML or markdown tricks) */
function clean(s, n) {
  return String(s || '').replace(/[<>@`*_\[\]|#\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n || 120);
}
function board(r) {
  var a = r.answers || {};
  return (BRANDS[a.brand] || 'Brand not given') + (a.model ? ' · ' + clean(a.model) : '');
}
function system(r) {
  var s = r.system || {};
  return clean(s.os || 'unknown system', 80) + ' · ' + clean(s.browser || 'unknown browser', 60);
}
function list(o) {   // { mouse: 3, pen: 1 } -> "mouse ×3, pen"
  return Object.keys(o || {}).map(function (k) { return k + (o[k] > 1 ? ' ×' + o[k] : ''); }).join(', ');
}
function stepRow(st) {
  var s = st.seen || {};
  var other = [];
  if (s.taps) other.push(s.taps + ' taps');
  if (s.cancels) other.push(s.cancels + ' cancelled');
  if (s.outsidePad) other.push(s.outsidePad + ' outside the area');
  if (s.wheel) other.push(s.wheel + ' scroll' + (s.ctrlWheel ? ' (' + s.ctrlWheel + ' zoom)' : ''));
  if (s.contextMenu) other.push(s.contextMenu + ' right-click');
  if (s.gestures) other.push(s.gestures + ' pinch');
  if (s.touchEvents) other.push(s.touchEvents + ' touch events, up to ' + s.maxTouches + ' at once');
  if (s.maxAtOnce > 1) other.push(s.maxAtOnce + ' pointers at once');
  if (s.tilt) other.push('tilt');
  if (list(s.buttonPresses)) other.push('buttons pressed with ' + list(s.buttonPresses));
  var status = st.skipped ? 'skipped' : !st.visited ? 'not reached' : (s.lines || 0) + (s.lines === 1 ? ' line' : ' lines');
  return '| ' + [STEP_NAMES[st.id] || clean(st.id, 20), status, list(s.types) || '—', list(s.kinds) || '—', s.eraserButton || 0,
    (s.maxWidth || 0) + '×' + (s.maxHeight || 0), s.maxPressure || 0, other.join(', ') || '—'].join(' | ') + ' |';
}
function summary(r) {
  var d = r.device || {}, sc = d.screen || {}, p = d.pointer || {}, a = r.answers || {};
  var lines = [
    '**Board:** ' + board(r),
    '**Computer:** ' + system(r) + (d.cpuCores ? ' · ' + d.cpuCores + ' cores' : '') + (d.memoryGB ? ' · ' + d.memoryGB + ' GB+' : ''),
    '**Screen:** ' + sc.w + '×' + sc.h + ' at ' + d.devicePixelRatio + 'x · touch points: ' + d.maxTouchPoints +
      ' · pointer: ' + (p.coarse ? 'coarse' : p.fine ? 'fine' : 'none') + (p.anyCoarse && p.anyFine ? ' (has both)' : ''),
    '**Opened from:** ' + clean(r.from, 20) + (r.overlayVersion ? ' (overlay ' + clean(r.overlayVersion, 10) + ')' : '') +
      ' · site ' + clean(r.release, 10) + ' · took ' + r.tookSeconds + ' s' + (r.startedWith ? ' · Start pressed with: ' + clean(r.startedWith.pointerType, 20) : ''),
    '**Problems ticked:** ' + ((a.problems || []).map(function (x) { return clean(x, 30); }).join(', ') || 'none'),
    '',
    '| Step | Result | Browser saw | OverBoard read it as | Eraser button | Max size | Max pressure | Other |',
    '|---|---|---|---|---|---|---|---|',
  ];
  (r.steps || []).forEach(function (st) { lines.push(stepRow(st)); });
  return lines.join('\n');
}

/* ---------- GitHub ---------- */
function openIssue(r, props) {
  var token = props.getProperty('GITHUB_TOKEN'), repo = props.getProperty('GITHUB_REPO') || 'BPMData/OverBoard';
  if (!token) throw new Error('GITHUB_TOKEN is not set');
  var title = ('Board report: ' + board(r) + ' · ' + system(r)).slice(0, 200);
  var body = summary(r) + '\n\n' + rawBlock(r) + '\n\n<sub>Sent from the "Board not working?" page. The person\'s email and comments, if any, went to the reports inbox only.</sub>';
  var res = UrlFetchApp.fetch('https://api.github.com/repos/' + repo + '/issues', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    payload: JSON.stringify({ title: title, body: body, labels: ['board-report'] }),
  });
  if (res.getResponseCode() !== 201) throw new Error('GitHub said ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
  return JSON.parse(res.getContentText());
}
/* the whole report as JSON, trimming the raw events (from the last step back) until it fits in an issue */
function rawBlock(r) {
  var copy = JSON.parse(JSON.stringify(r)), note = '';
  if (copy.answers && copy.answers.model) copy.answers.model = clean(copy.answers.model);
  function block() { return '<details><summary>Full report (JSON)' + note + '</summary>\n\n```json\n' + JSON.stringify(copy, null, 1) + '\n```\n</details>'; }
  var steps = copy.steps || [];
  for (var i = steps.length - 1; i >= 0 && block().length > ISSUE_LIMIT - 6000; i--) {
    steps[i].events = steps[i].events.slice(0, 20);
    note = ' (raw events trimmed; the email has all of them)';
  }
  for (var j = steps.length - 1; j >= 0 && block().length > ISSUE_LIMIT - 6000; j--) steps[j].events = [];
  return block();
}

/* ---------- email ---------- */
function emailReport(r, priv, issue, issueError, props) {
  var to = props.getProperty('NOTIFY_EMAIL') || Session.getEffectiveUser().getEmail();
  var email = String(priv.email || '').trim(), okEmail = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email);
  var text = [
    issue ? 'GitHub issue: ' + issue.html_url : 'The GitHub issue could not be made: ' + (issueError || 'unknown reason'),
    '',
    'Their email: ' + (email || '(none given)') + (okEmail ? '  (Reply to this message to answer them.)' : ''),
    'Their comments: ' + (priv.comments ? '\n' + String(priv.comments).slice(0, 4000) : '(none)'),
    '',
    summary(r).replace(/\*\*/g, ''),
    '',
    'The full report is attached.',
  ].join('\n');
  var full = JSON.stringify(r, null, 1);
  var opts = { to: to, subject: 'OverBoard board report: ' + board(r) + ' · ' + system(r), body: text,
    attachments: [Utilities.newBlob(full, 'application/json', 'OverBoard-board-report.json')] };
  if (okEmail) opts.replyTo = email;
  MailApp.sendEmail(opts);
}

/* ---------- run this once from the editor (▶ Run) to check the setup ---------- */
function checkSetup() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('GITHUB_TOKEN'), repo = props.getProperty('GITHUB_REPO') || 'BPMData/OverBoard';
  if (!token) throw new Error('Add GITHUB_TOKEN under Project Settings ▸ Script properties first.');
  var res = UrlFetchApp.fetch('https://api.github.com/repos/' + repo, { muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' } });
  if (res.getResponseCode() !== 200) throw new Error('GitHub token problem (' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 200));
  var perms = JSON.parse(res.getContentText()).permissions || {};
  Logger.log('GitHub token works for ' + repo + (perms.push || perms.triage ? ' (labels will be set)' : ''));
  var to = props.getProperty('NOTIFY_EMAIL') || Session.getEffectiveUser().getEmail();
  MailApp.sendEmail(to, 'OverBoard relay: setup check', 'If you can read this, the relay can email you. Next: Deploy ▸ New deployment (see docs/REPORTS.md).');
  Logger.log('Sent a test email to ' + to + '. All set.');
}
