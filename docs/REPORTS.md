# Board reports: setup

The **Board not working?** page (`app/report/`) walks a teacher through a few touches, asks for the board's brand, and sends a report when they press **Send**. Reports go to a small Google script (`tools/report-relay.gs`) that runs under the reports Gmail account, **overboard.reporting@gmail.com**. For each report it:

1. opens a GitHub issue labeled **board-report**, with the board, the computer, and what the board sent for each step,
2. emails the full report to the reports inbox, with the teacher's email address and comments. Those two never go into the public issue. Press **Reply** on the email to answer the teacher, and
3. if the teacher gave an email: sends them a thank-you right away, and remembers their address (privately, in the script's settings) for one follow-up.

**The follow-up.** Once a day the script checks GitHub. When a report's issue has been **closed as completed**, it emails that teacher: a short paragraph about what changed (written by Claude Haiku from your comments on the issue and the titles of your pull requests that mention it), then fixed instructions for making sure OverBoard has reloaded, with the version number to look for. Then it forgets the address. An issue closed as **not planned** (or as a duplicate) sends nothing.

So, when you fix a board problem: put `Fixes #12` in the pull request (merging it closes issue #12), and if you like, leave a one-line comment on the issue saying what changed in plain words. Haiku only reads comments from you and collaborators, never from strangers, and it never sees the teacher's email or private comments.

If the page can't reach the script (some school networks block it), the teacher downloads the report and emails it to the same address.

This setup is done once and takes about 15 minutes.

## 1. Make a GitHub key that can only open issues

1. On GitHub, go to **Settings ▸ Developer settings ▸ Personal access tokens ▸ Fine-grained tokens ▸ Generate new token** ([direct link](https://github.com/settings/personal-access-tokens/new)).
2. **Token name:** `OverBoard reports`. **Expiration:** the longest it offers. Put a reminder in your calendar a week before it runs out.
3. **Repository access:** *Only select repositories* ▸ **OverBoard**.
4. **Permissions ▸ Repository permissions ▸ Issues:** *Read and write*. Leave everything else as it is.
5. **Generate token** and copy it (it starts with `github_pat_`). GitHub shows it only once. Don't paste it anywhere except step 2.4 below.
6. In the OverBoard repository, go to **Issues ▸ Labels ▸ New label** and add one called `board-report`.

## 2. Make the Google script

Sign in to Google as **overboard.reporting@gmail.com** (a private/incognito window avoids mixing up accounts).

1. Go to [script.google.com](https://script.google.com) ▸ **New project**. Rename it (top left) to `OverBoard reports`.
2. Delete what's in `Code.gs`, then paste in all of [`tools/report-relay.gs`](../tools/report-relay.gs). Press **Save** (the disk icon).
3. Click **Project Settings** (the gear on the left), scroll to **Script properties** ▸ **Add script property**.
4. Add these, one per row, then **Save script properties**:
   - `GITHUB_TOKEN`: the token from step 1.5
   - `GITHUB_REPO`: `BPMData/OverBoard`
   - Skip `NOTIFY_EMAIL`. Without it, each report is emailed once, to the reports inbox itself. (Only add it if you ever want reports sent to some other address instead.)
5. Back in the **Editor** (the `< >` icon), choose **checkSetup** in the function menu at the top and press **▶ Run**.
   - Google asks for permission. Choose the reports account, then **Advanced ▸ Go to OverBoard reports (unsafe)** ▸ **Allow**. ("Unsafe" only means Google hasn't reviewed this script. It's your own script running in your own account.)
   - The log at the bottom should say the token works and a test email was sent. If it shows an error instead, the message says what to fix.

## 3. Put it online

1. **Deploy ▸ New deployment**. Click the gear next to *Select type* ▸ **Web app**.
2. **Description:** `v1`. **Execute as:** *Me*. **Who has access:** *Anyone*.
3. **Deploy**, then copy the **Web app URL** (it ends in `/exec`).
4. Paste that URL into `RELAY_URL` near the top of the script in `app/report/index.html` (or give it to Claude to do), then run `python3 tools/build.py` and make a PR as usual.

To check it's live: open the Web app URL in a browser. It should show `{"ok":true,"hello":"OverBoard report relay"}`.

## 4. Turn on the follow-up emails

1. **Claude API key** (optional, for Haiku's paragraph): at [console.anthropic.com](https://console.anthropic.com), add a few dollars of credit and create an API key. Add it as the script property `ANTHROPIC_API_KEY`. Each follow-up costs well under a cent. Without a key, follow-ups use a plain fixed paragraph instead.
2. In the editor, choose **installDailyCheck** in the function menu and press **▶ Run**. Google asks for permission again (this time to run on a schedule). The check now runs once a day around 3 pm.
3. To see what a follow-up looks like without emailing anyone: in the editor, open **previewFollowUp**, change `n = n || 1` to an issue number, and press **▶ Run**. The preview goes to the reports inbox.

## Changing the script later

Edit the code, save, then **Deploy ▸ Manage deployments ▸ ✏️ (edit) ▸ Version: New version ▸ Deploy**. This keeps the same URL, so the page doesn't need to change. (A *New deployment* gets a new URL.)

## Good to know

- **Limits.** At most 20 reports an hour are accepted; more than that is a robot. A gmail.com account can send about 100 emails a day.
- **Spam.** The page has a hidden box that people never see and robots fill in. Reports with it filled are thrown away (the robot is told it worked). The email address is in the page, so the inbox may get some ordinary spam.
- **Teachers' addresses** are kept only in the script's settings (Project Settings ▸ Script properties, as `contact:12` and so on), until their report is closed, or for a year at most. You can delete one there to stop its follow-up.
- **When the token expires,** issues stop being made but the emails still arrive, each saying why the issue failed. Make a new token (step 1) and replace `GITHUB_TOKEN` (step 2.4). No new deployment is needed.
- **What's in a report:** browser and operating system, screen size, touch support, CPU cores and memory (Chrome), the OverBoard version, and for each step what kind of input the browser saw (pen, mouse, touch), its buttons, size and pressure, plus up to 150 sample events. Never worksheets, PDFs, ink, file names or the page they were on.
