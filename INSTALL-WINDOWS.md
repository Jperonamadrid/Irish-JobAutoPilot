# Installing JobPilot on Windows

About 15 minutes, once. You need an internet connection and a Claude account (Pro or higher) for the AI.

## 1. Install the four things it needs

Install each with the default options (just keep clicking **Next**):

1. **Node.js (LTS)**: https://nodejs.org → "Windows Installer (.msi)"
2. **Git for Windows**: https://git-scm.com/download/win (Claude Code uses it)
3. **Google Chrome**: https://www.google.com/chrome/ (skip if you already have it)
4. **Claude Code**: open **PowerShell** (Start menu → type `PowerShell`) and paste:
   ```
   irm https://claude.ai/install.ps1 | iex
   ```
   When it finishes, close PowerShell, open a new one, type `claude` and press Enter. Sign in with your Claude account in the browser window that opens. Then type `/exit`.

## 2. Get JobPilot

**Option A, with a download (simplest):** whoever has access to the GitHub repository opens it, clicks **Code → Download ZIP**, and gives you the ZIP file. Right-click it → **Extract All…** → put it somewhere easy such as `Documents\JobPilot`.

**Option B, with Git (easy updates later):** if you have been added to the repository, open PowerShell and run:
```
cd $HOME\Documents
git clone https://github.com/Jperonamadrid/Irish-JobAutoPilot.git JobPilot
```

## 3. Start it

Open the JobPilot folder and **double-click `start.bat`**.

- If Windows says "Windows protected your PC", click **More info → Run anyway** (it is a plain script you can open in Notepad to check).
- The first start installs what it needs (2-5 minutes). After that, your browser opens **http://localhost:4317**.
- **Leave the black window open** while you use JobPilot. Closing it stops the app.

For a desktop icon, right-click `start.bat` → **Show more options → Send to → Desktop (create shortcut)**.

## 4. Use it

Click **Get started** and follow the steps: upload your CV, check your details, take the career quiz (optional), pick job titles, choose how to apply, run the first market scan.

To use your IrishJobs / Jobs.ie / LinkedIn accounts, press **Sign in to job sites** on Home, sign in on each tab, then close that Chrome window.

## Updating later

- **Option A (ZIP):** download the new ZIP and copy everything over the old folder **except the `users` folder** (that is your CV, answers and jobs: never delete it).
- **Option B (Git):** in PowerShell, `cd $HOME\Documents\JobPilot` then `git pull`.

## If something does not work

In the JobPilot folder, click the address bar, type `cmd`, press Enter, and run:
```
npm run doctor
```
It checks every part and says what to fix in plain words.
