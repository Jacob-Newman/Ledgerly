# Ledgerly

Ledgerly is a budgeting app for CSV exports from checking accounts, savings
accounts, and credit cards. It categorizes spending, removes duplicate
transactions, and excludes matching transfers and credit-card payments from
spending totals.

The app has:

- A React and Vite frontend
- A Python and FastAPI backend
- No login
- No database
- No bank connection
- No required `.env` file

Uploaded CSV data is processed in memory for the current browser session. The
backend does not save statements to a database or write them to disk. Refreshing
the page clears the current session.

## Project structure

```text
.
├── src/                         React frontend
├── apps/api/
│   ├── ledgerly_api/            FastAPI backend and CSV analyzer
│   └── tests/                   Automated tests and sample fixtures
├── Dockerfile                   Production build for Render
├── render.yaml                  Render service configuration
├── package.json                 Frontend commands and dependencies
└── vite.config.ts               Local Vite server and API proxy
```

## Requirements for local development

Install:

- [Node.js](https://nodejs.org/) 20.19 or newer
- [Python](https://www.python.org/downloads/) 3.11 or newer
- [Git](https://git-scm.com/downloads) if you want to use GitHub

No Docker installation is required to run the app locally or deploy it through
Render.

## Run locally on Windows

Open PowerShell in the extracted project folder.

### 1. Install the frontend packages

```powershell
npm install
```

### 2. Create the Python virtual environment

Windows commonly provides Python through the `py` launcher even when the
`python` command is unavailable:

```powershell
py -m venv .venv
```

### 3. Install the backend

Use the virtual environment's Python executable directly. This avoids PowerShell
activation and PATH problems:

```powershell
.\.venv\Scripts\python.exe -m pip install -e ".\apps\api[dev]"
```

### 4. Start the backend

```powershell
.\.venv\Scripts\python.exe -m uvicorn ledgerly_api.main:app --app-dir .\apps\api --reload --port 8000
```

Leave that PowerShell window open.

### 5. Start the frontend

Open a second PowerShell window in the same project folder:

```powershell
npm run dev:web
```

Open [http://localhost:5173](http://localhost:5173). Both terminal windows must
remain open while using the local app.

## Run locally on macOS or Linux

From the project folder:

```bash
npm install
python3 -m venv .venv
./.venv/bin/python -m pip install -e "./apps/api[dev]"
```

Start the backend:

```bash
./.venv/bin/python -m uvicorn ledgerly_api.main:app --app-dir ./apps/api --reload --port 8000
```

In a second terminal, start the frontend:

```bash
npm run dev:web
```

Open [http://localhost:5173](http://localhost:5173).

## Put the project on GitHub

Do not place real bank statements inside the project folder. The included
`.gitignore` blocks CSV files except for the artificial test fixtures, but
keeping personal exports elsewhere is safer.

### 1. Create the GitHub repository

On GitHub:

1. Select **New repository**.
2. Name it `ledgerly-budget`.
3. Choose **Private** unless you intentionally want the source public.
4. Do not add a README, `.gitignore`, or license on GitHub.
5. Create the empty repository.

### 2. Push this project

Run these commands from the project folder. Replace `YOUR_USERNAME` with your
GitHub username:

```powershell
git init
git add .
git commit -m "Initial Ledgerly app"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/ledgerly-budget.git
git push -u origin main
```

GitHub may open a browser window so you can authorize the push. You can also use
GitHub Desktop if you prefer a graphical interface.

## Deploy to Render

The repository includes a `Dockerfile` and `render.yaml`. Render builds the
React frontend, installs the FastAPI backend, and hosts both from one web
service. No database or environment variables are required.

### 1. Create the service

1. Push the project to GitHub using the steps above.
2. Sign in at [Render](https://dashboard.render.com/).
3. Select **New**, then **Blueprint**.
4. Connect your GitHub account if prompted.
5. Select the `ledgerly-budget` repository.
6. Render will detect `render.yaml`.
7. Review the proposed `ledgerly-budget` web service and select **Deploy
   Blueprint**.

The first build can take several minutes. When it finishes, Render provides an
address similar to:

```text
https://ledgerly-budget.onrender.com
```

No build command, start command, port, database, secret, or `.env` value needs
to be entered manually.

### 2. Future updates

After editing the project:

```powershell
git add .
git commit -m "Describe the changes"
git push
```

Render automatically deploys each new commit pushed to the repository's default
branch.

### Free Render service behavior

The included Blueprint selects Render's free web-service plan. Render can put a
free service to sleep after a period without traffic. The first visit after it
sleeps may take approximately one minute to load. You can change to a paid
instance later in the Render dashboard.

## Run a production build locally

Build the React frontend:

```powershell
npm run build
```

Then start FastAPI from the project root:

```powershell
.\.venv\Scripts\python.exe -m uvicorn ledgerly_api.main:app --app-dir .\apps\api --port 8000
```

Open [http://localhost:8000](http://localhost:8000). In this mode, FastAPI serves
the compiled React frontend and the API from the same port, matching the Render
deployment structure.

## Tests

After completing the local installation:

```powershell
npm run typecheck
npm run build
.\.venv\Scripts\python.exe -m pytest .\apps\api\tests
```

The tests verify:

- American Express purchases are treated as expenses.
- Generic credit-card exports with positive purchases are treated as expenses.
- Matching checking-account and credit-card payments are excluded.
- Reimporting overlapping statements does not duplicate transactions.

## Supported CSV imports

- Chase checking
- Chase savings
- Chase credit cards
- American Express credit cards
- Generic files with `Date`, `Description`, and `Amount` columns

For generic CSVs, select credit card, checking, or savings in the import window.
Credit-card purchases are normalized whether the bank exports charges as
positive or negative values.

## Privacy and security notes

- The hosted website has no login. Anyone who knows its public Render URL can
  open it.
- Uploaded statements are processed for the request and are not persisted by
  the backend.
- The current session's analyzed data exists in the browser and is cleared by a
  refresh.
- HTTPS is provided by Render for the `onrender.com` address.
- Do not commit real bank statements, API keys, passwords, or `.env` files to
  GitHub.
