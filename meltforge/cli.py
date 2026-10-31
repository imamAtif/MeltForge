"""
MeltForge CLI Entrypoint - Launches the server and auto-opens the browser.
"""

import click
import uvicorn
import webbrowser
import threading
import time
import os
from pathlib import Path


@click.group()
def cli():
    """MeltForge: Modern GitOps-first visual interface for Meltano."""
    pass


@cli.command()
@click.option("--host", default="127.0.0.1", help="Host address to bind to.")
@click.option("--port", default=8080, type=int, help="Port to listen on.")
@click.option("--project-dir", default=None, help="Meltano project root directory.")
@click.option("--no-browser", is_flag=True, default=False, help="Do not automatically open web browser.")
@click.option("--reload/--no-reload", default=True, help="Auto-reload on code changes.")
def start(host: str, port: int, project_dir: str, no_browser: bool, reload: bool):
    """Start the MeltForge web studio."""
    if project_dir:
        os.environ["MELTANO_PROJECT_ROOT"] = str(Path(project_dir).resolve())

    url = f"http://{host}:{port}"
    click.echo(click.style(f"🔥 Starting MeltForge on {url} ...", fg="bright_yellow", bold=True))

    if not no_browser:
        def open_browser():
            time.sleep(1.2)
            webbrowser.open(url)
        threading.Thread(target=open_browser, daemon=True).start()

    uvicorn.run(
        "meltforge.server:app",
        host=host,
        port=port,
        log_level="info",
        reload=reload
    )


if __name__ == "__main__":
    cli()
