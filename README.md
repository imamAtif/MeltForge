# MeltForge 🔥

> **GitOps-first Visual DataOps Studio for Meltano.**  
> Effortlessly configure, test, and orchestrate Singer extractors and loaders with a beautiful, modern no-code UI that directly reads and commits to `meltano.yml`.

---

## ✨ Why MeltForge?

When Meltano v3.0 deprecated its legacy UI to refocus on CLI & GitOps, non-technical teams and data analysts were left having to write raw YAML and manage terminal commands. 

**MeltForge** bridges that gap without introducing heavy, proprietary databases:
- **100% GitOps & Code-First:** Every action in the UI directly updates your native `meltano.yml` (preserving human comments and formatting with `ruamel.yaml`).
- **Secrets Management:** Credentials (`password`, `api_token`) are automatically kept out of `meltano.yml` and securely placed in `.env` (ignored by Git).
- **Meltano Hub Catalog:** Search across all official and community Singer extractors (PostgreSQL, MySQL, Salesforce, Stripe, Sheets...) and loaders (Snowflake, BigQuery, DuckDB, S3...).
- **Dynamic Configuration & Connection Testing:** Automatically generates typed form fields for connector settings and lets you test connections before saving.
- **Visual Stream & Table Selection:** Browse discovered tables and columns and toggle replication with a simple checklist.
- **Real-Time Execution Logs:** Stream live pipeline runs (`meltano run <tap> <target>`) with WebSockets directly in the browser terminal.
- **Git Control Bar:** Check branch status, uncommitted changes, pull, commit, and revert right from the UI.

---

## 🚀 Quick Start

### Installation

Inside your project or virtual environment:

```bash
git clone https://github.com/imamAtif/MeltForge.git
cd MeltForge
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
```

### Starting the Studio

Run in your terminal:

```bash
meltforge start
```

This will automatically launch the server and open your default browser at:
`http://127.0.0.1:8080`

To run on a custom port or headless (Docker/Remote VM):

```bash
meltforge start --port 9000 --no-browser
```

---

## 🛠️ Tech Stack

* **Backend:** Python 3.9+, FastAPI, Uvicorn, `ruamel.yaml` (round-trip AST preserving YAML), `python-dotenv`, `httpx`, WebSockets, Click CLI.
* **Engine:** Meltano CLI & Singer Specification (`meltano.yml` as single source of truth).
* **Frontend:** Modern semantic HTML5, Vanilla CSS design system (Linear/Vercel inspired dark mode), Vanilla JavaScript with reactive state and WebSockets. Zero Node build step needed.

---

## 📄 License

Apache 2.0
