#!/usr/bin/env python3
"""
Interactive TUI to monitor Supabase normalization for a vehicle and trigger
existing Node workflows (catalog sync, one-per-bucket test).

Run from repo root (after pip install -r tools/normalization_tui/requirements.txt):

    python tools/normalization_tui/app.py

Requires:
  - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (vehapiproxi/.env or env)
  - vehapiproxi running for sync / test (default http://localhost:3001)

Keys: q quit | Enter in vehicle/source/proxy fields refreshes stats | r refresh | h/s/t/m as below
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path
from urllib.parse import quote

import httpx
from textual import work
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Container, Horizontal, Vertical
from textual.screen import ModalScreen
from textual.widgets import Button, DataTable, Footer, Header, Input, Label, RichLog, Static

# Repo root: tools/normalization_tui/app.py -> parents[2] = vehapi
REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parent))

from stats import (
    env_config,
    fetch_all_stats,
    load_env,
    proxy_health,
)


class ConfirmScreen(ModalScreen[bool]):
    """Yes / No for destructive actions."""

    def __init__(self, message: str) -> None:
        super().__init__()
        self.message = message

    def compose(self) -> ComposeResult:
        yield Static(self.message, id="confirm-msg")
        with Horizontal(id="confirm-row"):
            yield Button("Yes", variant="error", id="yes")
            yield Button("No", variant="primary", id="no")

    def on_button_pressed(self, event: Button.Pressed) -> None:
        self.dismiss(event.button.id == "yes")


class NormalizationTui(App[None]):
    CSS = """
    Screen { background: $surface; }
    #top-bar { height: auto; min-height: 3; margin: 0 1; }
    #main-row { height: 1fr; margin: 0 1; }
    #left { width: 44; min-width: 44; margin-right: 1; }
    #stats-panel { height: 1fr; border: solid $primary; padding: 0 1; }
    #log { height: 14; border: solid $accent; margin: 1; padding: 0 1; }
    DataTable { height: 1fr; }
    RichLog { background: $panel; }
    #status-line { margin: 0 1; color: $text-muted; }
    #confirm-msg { margin: 1 2; width: 60; }
    #confirm-row { margin: 1 2; height: auto; }
    """

    BINDINGS = [
        Binding("q", "quit", "Quit", show=True),
        Binding("r", "refresh_stats", "Refresh", show=True),
        Binding("h", "health", "Health", show=True),
        Binding("s", "sync_catalog", "Sync catalog", show=True),
        Binding("t", "run_test", "Test script", show=True),
        Binding("m", "toggle_monitor", "Auto-refresh", show=True),
    ]

    def __init__(self) -> None:
        super().__init__()
        load_env(str(REPO_ROOT))
        self._cfg = env_config(str(REPO_ROOT))
        self._monitor = True
        self._poll_task: asyncio.Task | None = None

    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        with Vertical():
            with Container(id="top-bar"):
                yield Label(
                    "Vehicle ID (external_id, e.g. 81596:10217 or MOTOR id):", classes="label"
                )
                with Horizontal():
                    yield Input(
                        value=self._cfg.get("vehicle_id", ""),
                        placeholder="vehicle id",
                        id="vehicle-input",
                    )
                    yield Input(
                        value=self._cfg.get("content_source", "MOTOR"),
                        placeholder="content source",
                        id="source-input",
                    )
                    yield Input(
                        value=self._cfg.get("proxy_url", "http://localhost:3001"),
                        placeholder="proxy base URL",
                        id="proxy-input",
                    )
            with Horizontal(id="main-row"):
                with Vertical(id="left"):
                    yield Static("[bold]Actions[/] (or keys h/s/t/r/m)", id="help")
                    yield Button("Refresh stats (r)", id="btn-refresh", variant="primary")
                    yield Button("Proxy health (h)", id="btn-health")
                    yield Button("Catalog sync (s)", id="btn-sync", variant="warning")
                    yield Button("One-per-bucket test (t)", id="btn-test", variant="error")
                    yield Button("Toggle auto-refresh (m)", id="btn-monitor")
                    yield Static("", id="monitor-state")
                with Vertical(id="stats-panel"):
                    yield Static("[bold]Supabase row counts[/] (service role)", id="stats-title")
                    yield DataTable(id="stats-table")
            yield RichLog(id="log", highlight=True, markup=True)
            yield Static(
                "Auto-refresh ~5s when enabled. Catalog sync needs vehapiproxi + Motor session.",
                id="status-line",
            )
        yield Footer()

    def on_mount(self) -> None:
        table: DataTable = self.query_one("#stats-table", DataTable)
        table.add_columns("Table", "Rows", "Note")
        table.can_focus = False
        self._log = self.query_one("#log", RichLog)
        self._log.can_focus = False
        self._log.write("[dim]Normalization monitor — type vehicle id, press [bold]Enter[/] to refresh stats.[/]")
        self.action_refresh_stats()
        self.set_interval(5.0, self._tick_monitor)
        # DataTable/RichLog otherwise steal focus; keep typing in the top inputs.
        self.set_timer(0.05, self._focus_vehicle_input)

    def _focus_vehicle_input(self) -> None:
        try:
            self.query_one("#vehicle-input", Input).focus()
        except Exception:
            pass

    def on_input_submitted(self, event: Input.Submitted) -> None:
        """Enter in any config field applies vehicle id and reloads Supabase counts."""
        self.action_refresh_stats()

    def _tick_monitor(self) -> None:
        if self._monitor:
            self.action_refresh_stats()

    def _current_inputs(self) -> tuple[str, str, str]:
        vid = self.query_one("#vehicle-input", Input).value.strip()
        src = self.query_one("#source-input", Input).value.strip() or "MOTOR"
        proxy = self.query_one("#proxy-input", Input).value.strip() or "http://localhost:3001"
        return vid, src, proxy.rstrip("/")

    @work(exclusive=True)
    async def action_refresh_stats(self) -> None:
        url = self._cfg.get("supabase_url", "")
        key = self._cfg.get("service_key", "")
        vid, _, _ = self._current_inputs()
        if not url or not key:
            self._log.write("[red]Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY[/]")
            return
        if not vid:
            self._log.write("[yellow]Set a vehicle id to load stats.[/]")
            return
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                stats = await fetch_all_stats(client, url, key, vid)
        except Exception as e:
            self._log.write(f"[red]Stats error:[/] {e}")
            return

        table = self.query_one("#stats-table", DataTable)
        table.clear()
        norm = stats.get("is_normalized")
        norm_s = "yes" if norm is True else "no" if norm is False else "n/a"
        table.add_row("vehicles.is_normalized", norm_s, "flag on vehicles row")
        for k in sorted(x for x in stats if x != "is_normalized"):
            n = stats[k]
            note = "query failed or table missing" if n < 0 else ""
            table.add_row(k, str(n) if n >= 0 else "?", note)
        mon = self.query_one("#monitor-state", Static)
        mon.update(f"Auto-refresh: [bold]{'ON' if self._monitor else 'OFF'}[/]")

    @work(exclusive=True)
    async def action_health(self) -> None:
        _, _, proxy = self._current_inputs()
        code, body = await proxy_health(proxy)
        msg = f"[cyan]GET /health[/] → [bold]{code}[/]\n{body[:800]}"
        self._log.write(msg)

    @work(exclusive=True)
    async def action_sync_catalog(self) -> None:
        vid, src, proxy = self._current_inputs()
        if not vid:
            self._log.write("[yellow]Set vehicle id first.[/]")
            return
        path = f"/api/source/{quote(src)}/vehicle/{quote(vid, safe='')}/articles/v2?torqueCatalogSync=1"
        url = f"{proxy}{path}"
        token = os.environ.get("SYNC_AUTH_BEARER") or ""
        headers = {"Accept": "application/json", "X-Vehapi-Verify": "1"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        self._log.write(f"[cyan]Catalog sync[/] {url[:120]}…")
        try:
            async with httpx.AsyncClient(timeout=180.0) as client:
                r = await client.get(url, headers=headers)
                text = r.text[:3000]
                self._log.write(f"[bold]HTTP {r.status_code}[/]\n{text}")
        except Exception as e:
            self._log.write(f"[red]Sync failed:[/] {e}")

    async def action_run_test(self) -> None:
        ok = await self.push_screen_wait(
            ConfirmScreen(
                "[bold red]Destructive:[/] runs test-normalization-one-per-category.js\n"
                "(clears vehicle tables in Supabase, then fetches one HTML per bucket).\n\nContinue?"
            )
        )
        if not ok:
            return
        vid, src, proxy = self._current_inputs()
        if not vid:
            self._log.write("[yellow]Set vehicle id first.[/]")
            return
        script = REPO_ROOT / "vehapiproxi" / "scripts" / "test-normalization-one-per-category.js"
        if not script.is_file():
            self._log.write(f"[red]Script not found:[/] {script}")
            return
        env = os.environ.copy()
        env["VEHICLE_ID"] = vid
        env["CONTENT_SOURCE"] = src
        env["PROXY_URL"] = proxy
        # Windows: shell=False, use node
        self._log.write(f"[cyan]Starting[/] node {script.name} … (long run)")
        try:
            proc = await asyncio.create_subprocess_exec(
                "node",
                str(script),
                cwd=str(REPO_ROOT),
                env=env,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
            assert proc.stdout
            while True:
                line = await proc.stdout.readline()
                if not line:
                    break
                self._log.write(line.decode(errors="replace").rstrip())
            rc = await proc.wait()
            self._log.write(f"[bold]Exit code {rc}[/]")
        except FileNotFoundError:
            self._log.write("[red]node not found on PATH[/]")
        except Exception as e:
            self._log.write(f"[red]{e}[/]")

    def action_toggle_monitor(self) -> None:
        self._monitor = not self._monitor
        mon = self.query_one("#monitor-state", Static)
        mon.update(f"Auto-refresh: [bold]{'ON' if self._monitor else 'OFF'}[/]")
        self._log.write(f"Auto-refresh [bold]{'ON' if self._monitor else 'OFF'}[/]")

    def action_quit(self) -> None:
        self.exit()

    def on_button_pressed(self, event: Button.Pressed) -> None:
        bid = event.button.id or ""
        if bid == "btn-refresh":
            self.action_refresh_stats()
        elif bid == "btn-health":
            self.action_health()
        elif bid == "btn-sync":
            self.action_sync_catalog()
        elif bid == "btn-test":
            asyncio.create_task(self.action_run_test())
        elif bid == "btn-monitor":
            self.action_toggle_monitor()


def main() -> None:
    NormalizationTui().run()


if __name__ == "__main__":
    main()
