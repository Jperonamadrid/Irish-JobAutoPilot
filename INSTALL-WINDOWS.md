# Installing JobPilot on Windows

About 5 minutes, once. You need an internet connection and a Claude account (Pro or higher) for the AI.

## 1. Run the installer

1. Open **PowerShell**: click Start, type `PowerShell`, press Enter.
2. Copy this line, paste it into PowerShell (right-click pastes), and press Enter:
   ```
   irm https://raw.githubusercontent.com/Jperonamadrid/Irish-JobAutoPilot/main/install/install.ps1 | iex
   ```

It installs everything JobPilot needs. Each part is only installed if it is missing:
- **JobPilot** goes into your user folder\JobPilot. Your CV and job list will live there too.
- **Node.js** goes inside the JobPilot folder. No admin rights are needed.
- **Git for Windows** is needed by Claude Code. Windows may ask *"Do you want to allow this app to make changes?"*: click **Yes**.
- **The PDF engine** and the rest of JobPilot's parts.
- **Claude Code**, the AI. When it asks you to sign in, a Claude Code window opens:
  1. Follow its steps and sign in with your Claude account in the browser.
  2. Type `/exit`.
  3. Close that window.
- **Shortcuts** on your Desktop and in the Start menu.

At the end JobPilot starts and your browser opens **http://localhost:4317**.

## 2. Use it

- Start JobPilot with the **JobPilot** icon on your Desktop. **Leave the black window open** while you use it; closing it stops the app.
- Click **Get started** and follow the steps:
  1. Upload your CV.
  2. Check your details.
  3. Take the career quiz (optional).
  4. Pick job titles.
  5. Choose how to apply.
  6. Run the first market scan.
- To use your IrishJobs / Jobs.ie / LinkedIn accounts, press **Sign in to job sites** on Home, sign in on each tab, then close that Chrome window.

## Updating

JobPilot tells you when a new version is out: the version number at the top turns green and Home shows **Update now**. Click it and JobPilot updates and restarts by itself, keeping your data.

Running the installer line again also updates it.

## If something does not work

- **"Running scripts is disabled on this system":** paste this first, then the installer line again:
  ```
  Set-ExecutionPolicy -Scope Process Bypass
  ```
- **Windows SmartScreen** warns about `start.bat`: click **More info → Run anyway**. It is a plain script you can open in Notepad to check.
- **Anything else:** open the JobPilot folder, click the address bar, type `cmd`, press Enter, and run:
  ```
  runtime\node\npm.cmd run doctor
  ```
  (or `npm run doctor` if you installed Node.js yourself). It checks every part and says what to fix in plain words.
