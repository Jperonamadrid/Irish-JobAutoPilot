# JobPilot

A job-search assistant that runs on your own computer. Give it your CV and it:

1. **Reads your CV** and suggests job titles you could do. A **career quiz** suggests better-paid options too, checked against live job ads near you.
2. **Scans the job market** (LinkedIn, IrishJobs.ie, Jobs.ie, CareerJet.ie, publicjobs.ie, JobsIreland.ie, RecruitIreland.com, Workable, remote feeds (Jobicy, Remote OK) and 100+ employers' career pages on Greenhouse, Ashby, Lever, Workable, SmartRecruiters, Recruitee, Personio and Workday, plus any company you choose to follow) and shows a **market report**: demand per title, stated pay, who is hiring, and where (map).
3. **Recommends jobs** with the reason each one fits, and makes a **tailored CV** (with a list of exactly what changed) and a **cover letter** for each.
4. Works in one of two modes, which you choose:
   - **Help me apply** (default): you get the link, the reasons, the CV and the letter, and you apply. It can also fill in a form for you to check and submit.
   - **Apply for me**: it also submits applications by itself on company sites it can fill in, but only when you switch it on, only for strong fits, only when every question is answered and the form is checked complete, and within a daily limit.

> Built for job searches in Ireland (Dublin and remote across Europe). Other countries need a new preset in `presets/`.

## Install (one step)

One command installs everything JobPilot needs and starts it. You only need a Claude account (Pro or higher) for the AI.

**Windows:** open **PowerShell** (Start menu → type `PowerShell`) and paste:
```
irm https://raw.githubusercontent.com/Jperonamadrid/Irish-JobAutoPilot/main/install/install.ps1 | iex
```

**macOS / Linux:** open **Terminal** and paste:
```
curl -fsSL https://raw.githubusercontent.com/Jperonamadrid/Irish-JobAutoPilot/main/install/install.sh | bash
```

It takes about 5 minutes and installs only what is missing:
- **JobPilot** itself, in your home folder (`JobPilot`). Running the installer again updates it and keeps your data.
- **Node.js**, inside the JobPilot folder, if your computer does not already have version 20 or newer. No admin password is needed.
- **Git for Windows** (Windows only), which Claude Code needs. Windows may ask you to allow it.
- **The PDF/browser engine** and the rest of JobPilot's parts.
- **Claude Code**, the AI JobPilot uses. The installer then opens it once so you can sign in.
- **A shortcut** on your Desktop and in your Start menu or app menu.

Afterwards, start JobPilot with the shortcut. It opens at **http://localhost:4317**. Keep its window open while you use it. Google Chrome is recommended for signing in to job sites, but JobPilot works without it.

Step-by-step help for Windows, including what to do if Windows warns you: [INSTALL-WINDOWS.md](INSTALL-WINDOWS.md). Check your setup any time with `npm run doctor` in the JobPilot folder.

<details><summary>Installing by hand instead</summary>

You need **Node.js 20+** (https://nodejs.org, LTS), **Claude Code** signed in (https://claude.com/claude-code) and, recommended, **Google Chrome**. Download or clone this repository, then double-click `start.bat` (Windows), `start.command` (macOS) or run `./start.sh` (Linux). The first start installs the rest. On Linux, `npm run shortcut` adds a menu icon.
</details>

## Updates

JobPilot checks for a new version when it starts and every few hours. When one is out, the version number at the top turns green and Home shows **what's new** with an **Update now** button. Updating takes a minute or two; your CV, answers, jobs and settings are kept, and JobPilot restarts by itself. Click the version number any time to check. From a terminal: `node cli.js update --install`.

*For the maintainer:* to release a version, raise `version` in `package.json`, add a section with the same number at the top of [CHANGELOG.md](CHANGELOG.md) (a test checks they match), and push to `main`. Everyone's JobPilot then offers it within a few hours.

## Using it

The first time, a guided setup takes you through six steps: **upload your CV** → **check your details** → **career quiz** (optional) → **pick job titles** (suggestions plus your own) → **choose a mode** → **first market scan** (about 10-15 minutes).

After that, press **Daily run** on Home, or let it start by itself every weekday morning (Profile → What you want → Automatic daily run; JobPilot needs to be open, and you get a notification when it finishes). It finds new jobs, scores them, makes CVs and letters for the best ones, and (in *Apply for me* mode) applies to the strongest fits. Then:

- **Jobs** lists your recommended jobs, with the link, why each fits, the tailored CV (PDF and Word), the cover letter, and what was changed.
- **Market** shows demand, stated pay, who is hiring, and suggested titles to add.
- **Map** shows where the jobs are.
- **Careers** lets you retake the quiz.
- **Not for me** asks for a one-tap reason (too senior, wrong location, pay...). Scoring learns from those and from the jobs you apply to.
- **Companies you'd love to work for** (Profile → What you want): paste a careers-page link or a company name, and that company's own job board is checked on every run.
- **Results** tracks what happened after you applied: record replies, interviews, offers and rejections, get a reminder to follow up after 10 days with no reply, and see which job sites, CV versions and fit scores actually get you answers. A follow-up email is ready to copy, and jobs marked *Interview* get **interview prep**: likely questions with answers built from your real CV, questions to ask them, and a 30-second pitch.
- **Questions** shows anything a form asked that your profile could not answer. Answer it once and it is reused everywhere.

Several people can use one install: each has their own profile, CV, answers, job list and browser logins (*+ Person* in the top bar).

## Safety and honesty rules built in

- **Nothing is submitted in "Help me apply" mode.** "Apply for me" must be switched on by the person, with a confirmation. It only submits when the fit score is at or above their minimum (80 by default), every required question was answered from their own profile, and a final check of the live form finds no empty required field. It submits at most the daily limit (10 by default) and one application per company per run, and keeps a screenshot of every submission.
- **Never invents facts.** Tailored CVs may reorder, reword and trim, but a fact check rejects any new employer, title, date, number, skill or qualification (including a tool or product name slipped into a reworded bullet) and falls back to your standard CV. Every job shows what was changed.
- **Always asks you** about legal waivers (arbitration), "I did not use AI" attestations, criminal record, non-compete and anything your profile does not cover. These are never auto-submitted.
- **Demographic questions** (gender, ethnicity, disability…) are answered "prefer not to say" or left blank.
- **Honest answers and estimates:** if a form asks for 8 years of experience and you have 4, it says no. Career salary ranges are labelled as estimates; pay figures in the market report come only from what job ads state.
- **No bot-check workarounds.** Indeed and Glassdoor block automated browsers; JobPilot does not try to get around that, and it never solves CAPTCHAs.
- **Polite to job sites.** If a site asks it to slow down, it stops calling that site for the rest of the run.

## Privacy

Everything stays on your computer in `users/<name>/` (CV, profile, answers, job list, browser logins). That folder is in `.gitignore` and must never be committed. The app listens on `127.0.0.1` only. Job text and your CV are sent to Claude (via Claude Code) to score jobs and write for you; nothing else leaves your machine except normal requests to job sites and the update check (which only downloads JobPilot's version number and change list from GitHub; set `JOBPILOT_NO_UPDATE_CHECK=1` to turn it off).

Your passwords are never stored by JobPilot. *Sign in to job sites* opens a normal Chrome window where you sign in yourself; only the site's login cookie stays in your profile folder.

## Cost

AI calls go through your Claude Code plan. Typical usage measured at API prices: about **0.5¢ per job scored** and **10-15¢ per application prepared** (tailored CV, cover letter, answers). A daily run is usually **$1-3**.

## How it works

```
cli.js / server/index.js     command line and local web app (tasks run as child processes)
core/intake.js               runs every source, de-duplicates, stores new jobs
core/sources/                boards.js (Greenhouse, Ashby, Lever, Workable, Workday, SmartRecruiters, Recruitee,
                             Personio), feeds.js (LinkedIn, Workable search, Jobicy, Remote OK, Jooble), irish.js
                             (CareerJet, publicjobs, JobsIreland, RecruitIreland), stepstone.js (IrishJobs, Jobs.ie)
core/discover.js             finds a company's own job board from jobs seen elsewhere; companies you follow
core/schedule.js             automatic daily run
core/prep.js                 interview prep notes
core/update.js               update check and one-click update
install/                     one-step installers (install.ps1 for Windows, install.sh for macOS and Linux)
start.sh, start.bat          launchers (restart JobPilot after an update; scripts/start-windows.cmd does the work on Windows)
core/score.js                AI scoring in batches (cheap model)
core/answers.js              form answers: profile → saved answers → rules → AI → ask you
core/cv.js                   CV rendering (PDF + Word), per-job tailoring and the fact check
core/ats/                    one form-filler per application system
core/apply.js                fill forms; review (you submit); auto-apply gates (Apply for me mode)
core/kit.js                  tailored CV + cover letter pack and the "what changed" list
core/outcomes.js             after applying: replies, interviews, follow-up reminders, what gets answers
core/market.js               market report (demand, stated pay, hiring companies)
core/careers.js              career quiz + live demand/pay check via CareerJet
core/geo.js                  rough job locations for the map (built-in list of Irish places)
presets/ireland.js           job sources for Ireland
templates/answers.json       starting rules for common form questions
users/<id>/                  each person's private data (never committed)
```

## Development

```
npm test          # unit tests (no network, no AI; uses saved samples in test/fixtures)
npm run doctor    # environment check
node cli.js help  # every command, e.g. node cli.js run --user <id>
```

Pull requests welcome. Please add a test with a saved sample for any new source or form filler.

## Disclaimer

Use JobPilot responsibly and within each job site's terms. It reads public job listings and fills in forms on your behalf for you to review; you are responsible for every application you submit.
