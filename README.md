# JobPilot

A job-search assistant that runs on your own computer. Give it your CV and tell it what you want; it then:

1. **Finds jobs** on LinkedIn, IrishJobs.ie, Jobs.ie, CareerJet.ie, publicjobs.ie, JobsIreland.ie, Workable, remote-job feeds and the career pages of 100+ employers.
2. **Scores each job** against your CV with AI and keeps the good fits.
3. **Prepares each application**: a CV tailored to the job, a cover letter, and every form field filled in.
4. **Stops before submitting.** You open each prepared application, check it, and click Submit yourself.

Nothing is ever sent to an employer without you.

> Built for job searches in Ireland (Dublin and remote across Europe). Other countries need a new preset in `presets/`.

## What you need

| | |
|---|---|
| **Node.js 20+** | https://nodejs.org (LTS) |
| **Claude Code**, signed in | https://claude.com/claude-code: the AI that scores jobs and writes for you. Uses your Claude subscription. |
| **Google Chrome** | recommended: forms are filled in Chrome, and you sign in to job sites there |

Windows, macOS and Linux are supported. A desktop session is needed for the review step (a browser window opens).

## Start

- **Linux / macOS:** double-click `start.sh` (macOS: `start.command`) or run `./start.sh`
- **Windows:** double-click `start.bat`

The first start installs everything (a minute or two). JobPilot then opens at **http://localhost:4317**. On Linux, `npm run shortcut` adds a menu/desktop icon.

Check your setup any time with `npm run doctor`.

## Using it

1. **Add yourself** and drop your CV (PDF or Word) into *Profile & CV*. The AI reads it, builds a clean CV, and suggests job titles and keywords. Any line it could not match exactly to your original CV is flagged for you to check.
2. Fill in **About you** (work permit, notice period, salary…) and check **What you want**.
3. On **Home**, press **Daily run**. It finds jobs, scores them, and prepares the best ones.
4. Press **Review & submit**. Each prepared application opens in a browser window, filled in. Check it, click **Submit**, close the tab, and the next one opens.
5. **Questions** lists anything a form asked that your profile could not answer (each question once). Answer it and it is reused everywhere.
6. Jobs on sites that cannot be filled in automatically (LinkedIn Easy Apply, IrishJobs, Workday…) are listed under **Apply by hand** with direct links. Press **I applied** when done.

Several people can use one install: each has their own profile, CV, answers, job list and browser logins (*+ Person* in the top bar).

## Safety and honesty rules built in

- **Never submits.** Only you click Submit.
- **Never invents facts.** Tailored CVs may reorder, reword and trim, but a fact check rejects any new employer, title, date, number, skill or qualification and falls back to your standard CV.
- **Always asks you** about legal waivers (arbitration), "I did not use AI" attestations, criminal record, non-compete and anything your profile does not cover.
- **Demographic questions** (gender, ethnicity, disability…) are answered "prefer not to say" or left blank.
- **Honest answers:** if a form asks for 8 years of experience and you have 4, it says no.
- **No bot-check workarounds.** Indeed and Glassdoor block automated browsers; JobPilot does not try to get around that.

## Privacy

Everything stays on your computer in `users/<name>/` (CV, profile, answers, job list, browser logins). That folder is in `.gitignore` and must never be committed. The app listens on `127.0.0.1` only. Job text and your CV are sent to Claude (via Claude Code) to score jobs and write for you; nothing else leaves your machine except normal requests to job sites.

Your passwords are never stored by JobPilot. *Sign in to job sites* opens a normal Chrome window where you sign in yourself; only the site's login cookie stays in your profile folder.

## Cost

AI calls go through your Claude Code plan. Typical usage measured at API prices: about **0.5¢ per job scored** and **10-15¢ per application prepared** (tailored CV, cover letter, answers). A daily run is usually **$1-3**.

## How it works

```
cli.js / server/index.js     command line and local web app (tasks run as child processes)
core/intake.js               runs every source, de-duplicates, stores new jobs
core/sources/                boards.js (Greenhouse, Ashby, Lever, Workable, Workday), feeds.js (LinkedIn,
                             Workable search, Jobicy, Jooble), irish.js (CareerJet, publicjobs, JobsIreland),
                             stepstone.js (IrishJobs, Jobs.ie)
core/discover.js             finds a company's own job board from jobs seen elsewhere
core/score.js                AI scoring in batches (cheap model)
core/answers.js              form answers: profile → saved answers → rules → AI → ask you
core/cv.js                   CV rendering (PDF + Word), per-job tailoring and the fact check
core/ats/                    one form-filler per application system
core/apply.js                prepare (fill, never submit) and review (you submit)
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
