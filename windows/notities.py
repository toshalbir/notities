"""Notes — fullscreen Windows agenda with 7 days, Moleskine week spread.

Run with: python notities.py
Build an exe with: maak-exe.bat
"""
from __future__ import annotations

import ctypes
import json
import os
import queue
import subprocess
import sys
import threading
from datetime import date, datetime, timedelta
from pathlib import Path

import tkinter as tk
from tkinter import font as tkfont
from tkinter import messagebox

from notities_core import (
    GitHubError,
    MONTHS,
    MONTHS_SHORT,
    TIMES,
    WEEKDAYS,
    WEEKDAYS_SHORT,
    day_number,
    describe_template,
    iso_day,
    iso_week,
    load_days,
    long_date,
    monday,
    load_settings,
    load_templates,
    merge_days,
    merge_templates,
    normalize_entry,
    normalize_templates,
    now_ms,
    occurrences_for_day,
    parse_day,
    save_days,
    save_settings,
    save_templates,
    short_weekday,
    sync_once,
    test_connection,
    template_signature,
    valid_day,
)

TEST = os.environ.get("NOTITIES_TEST") == "1"

# Warm paper palette: desk, cream pages, blue-black ink and a red margin.
BG = "#d9d4c8"
SURFACE = "#fffdf6"
WEEKEND = "#fbf8ef"
BORDER = "#d8d0be"
SHADOW = "#b9b2a4"
SPINE = "#c3bcae"
TEXT = "#33302a"
MUTED = "#8c877b"
INK = "#2f3b46"
LINE = "#dfe6e8"
HOUR_LINE = "#c6d0d4"
HOUR_TEXT = "#4b5056"
MARGIN = "#d99a96"
ACCENT = "#b34b42"
OK = "#3d7a50"
INK_COLORS = {
    "blue": "#2f3b46",
    "black": "#262626",
    "gray": "#5d5a52",
}

# Same layout, four kinds of paper. `paper` is the original Moleskine cream.
THEMES = {
    "paper": dict(
        BG="#d9d4c8", SURFACE="#fffdf6", WEEKEND="#fbf8ef", BORDER="#d8d0be",
        SHADOW="#b9b2a4", SPINE="#c3bcae", TEXT="#33302a", MUTED="#8c877b",
        INK="#2f3b46", LINE="#dfe6e8", HOUR_LINE="#c6d0d4", HOUR_TEXT="#4b5056",
        MARGIN="#d99a96", ACCENT="#b34b42",
    ),
    "rain": dict(
        BG="#cbd5d9", SURFACE="#f3f7f8", WEEKEND="#eaf1f3", BORDER="#c3ced3",
        SHADOW="#a7b5bb", SPINE="#b3c1c7", TEXT="#2e3b42", MUTED="#6f838c",
        INK="#31546a", LINE="#d8e3e7", HOUR_LINE="#b8cbd3", HOUR_TEXT="#465c67",
        MARGIN="#8fa9b5", ACCENT="#416c86",
    ),
    "sunset": dict(
        BG="#e6d4c4", SURFACE="#fff6ec", WEEKEND="#fdf0e2", BORDER="#e6cfb9",
        SHADOW="#c9ae98", SPINE="#d5bba7", TEXT="#4a352a", MUTED="#9a7f6c",
        INK="#6a3f2d", LINE="#f0dfd0", HOUR_LINE="#dfc4ab", HOUR_TEXT="#805e49",
        MARGIN="#d98f74", ACCENT="#b5563b",
    ),
    "graphite": dict(
        BG="#23272a", SURFACE="#2e3337", WEEKEND="#343a3e", BORDER="#4a5257",
        SHADOW="#171a1c", SPINE="#3c4347", TEXT="#e6e6e2", MUTED="#9aa2a8",
        INK="#d7dde3", LINE="#3d454a", HOUR_LINE="#596268", HOUR_TEXT="#b7bfc4",
        MARGIN="#8a6f6c", ACCENT="#d9756a",
    ),
}
THEME_INKS = {
    "graphite": {"blue": "#bcd3e2", "black": "#f4f4f0", "gray": "#c9c6bd"},
}
THEME_NAMES = {"paper": "Paper", "rain": "Rain", "sunset": "Sunset", "graphite": "Graphite"}
STICKY = {
    "paper": "#fff2ae", "rain": "#dbeaf0", "sunset": "#ffe0bd", "graphite": "#4c4936",
}


def apply_theme(name: str) -> dict:
    """Swap the module palette; callers then recolour existing widgets."""
    palette = THEMES.get(name, THEMES["paper"])
    globals().update(palette)
    return palette


def ink_for(theme: str, choice: str) -> str:
    return THEME_INKS.get(theme, INK_COLORS).get(choice, THEME_INKS.get(theme, INK_COLORS)["blue"])


def recolor(widget: tk.Misc, old: dict, new: dict) -> None:
    """Recolour an existing widget tree after a theme change."""
    mapping = {value: new[key] for key, value in old.items()}
    options = (
        "bg", "foreground", "activebackground", "activeforeground",
        "highlightbackground", "troughcolor", "insertbackground",
        "disabledforeground", "selectbackground",
    )
    try:
        configured = widget.configure()
        changes = {}
        for key in options:
            value = configured.get(key)
            if not value:
                continue
            color = value[-1] if isinstance(value, tuple) else value
            if color in mapping:
                changes[key] = mapping[color]
        if changes:
            widget.configure(**changes)
    except tk.TclError:
        pass
    for child in widget.winfo_children():
        recolor(child, old, new)


def visible_occurrences(templates: dict, days: dict, day, time_key: str | None = None) -> list:
    """Recurring items minus the ones cleared for this specific day."""
    hidden = normalize_entry(days.get(iso_day(day)))["hidden"]
    return [
        item for item in occurrences_for_day(templates, day, time_key)
        if item["id"] not in hidden
    ]


def resource_path(relative: str) -> Path:
    base = getattr(sys, "_MEIPASS", None)
    root = Path(base) if base else Path(__file__).resolve().parent
    return root / relative


def load_hand_font() -> str:
    """Load Patrick Hand privately for this process, so no install is needed."""
    path = resource_path("fonts") / "PatrickHand-Regular.ttf"
    if not path.exists():
        return "Segoe Print"
    try:
        gdi = ctypes.WinDLL("gdi32", use_last_error=True)
        if gdi.AddFontResourceExW(str(path), 0x10, 0):  # FR_PRIVATE
            return "Patrick Hand"
    except (AttributeError, OSError):
        pass
    return "Segoe Print"


class App:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.cfg = load_settings()
        self.theme = self.cfg.get("theme", "paper")
        apply_theme(self.theme)
        self.days = load_days()
        self.templates = load_templates()
        self.ink = ink_for(self.theme, self.cfg.get("ink", "blue"))
        self.queue: queue.Queue = queue.Queue()
        self.syncing = False
        self.pending_sync = False
        self.local_timer = None
        self.sync_timer = None
        self.undo_stack: list[str] = []
        self.redo_stack: list[str] = []
        self.focus_snapshot: str | None = None
        self.week_start = date.today() - timedelta(days=date.today().weekday())
        self.week_keys: list[str] = []
        self.slot_widgets: dict[tuple[int, str], tk.Entry] = {}
        self.done_widgets: dict[tuple[int, str], tk.Button] = {}
        self.note_widgets: dict[int, tk.Text] = {}
        self.head_widgets: list[tuple[tk.Label, tk.Label, tk.Frame]] = []
        self.test_label: tk.Label | None = None

        hand = load_hand_font()
        self.font_ui = tkfont.Font(root=root, family="Segoe UI", size=11)
        self.font_small = tkfont.Font(root=root, family="Segoe UI", size=10)
        self.font_bold = tkfont.Font(root=root, family="Segoe UI", size=11, weight="bold")
        self.font_time = tkfont.Font(root=root, family=hand, size=10)
        self.font_hour = tkfont.Font(root=root, family=hand, size=11, weight="bold")
        self.font_entry = tkfont.Font(root=root, family=hand, size=12)
        self.font_entry_done = tkfont.Font(root=root, family=hand, size=12, overstrike=1)
        self.font_notes = tkfont.Font(root=root, family=hand, size=12)
        self.font_ghost = tkfont.Font(root=root, family=hand, size=10)

        self.now_lines: dict[int, tk.Frame] = {}
        self.lastweek_labels: dict[int, tk.Label] = {}
        self.ghost_labels: dict[tuple[int, str], tk.Label] = {}
        self.mini_window: tk.Toplevel | None = None
        self.mini_body: tk.Frame | None = None
        self.mini_note: tk.Frame | None = None
        self.mini_position: tuple[int, int] | None = None
        self.mini_timer: str | None = None

        self._build()
        self.render()
        self._pump()

        root.bind("<Escape>", self.toggle_fullscreen)
        root.bind("<Control-s>", lambda _e: self.flush())
        root.bind("<Control-k>", lambda _e: self.open_search())
        root.bind("<Control-Alt-n>", self.focus_app)
        root.bind("<Control-z>", self.on_undo)
        root.bind("<Control-y>", self.on_redo)
        root.bind("<Control-Shift-Z>", self.on_redo)

        if not TEST:
            if self.cfg.get("token") and self.cfg.get("owner") and self.cfg.get("repo"):
                root.after(900, lambda: self.start_sync(True))
            else:
                root.after(600, self.open_settings)
            root.after(60000, self.poll)
        self.root.after(1200, self._tick_now)

    # ---------- Interface ----------

    def _build(self) -> None:
        self.root.configure(bg=BG)
        self.root.title("Notes v5 — Paper week")
        if not TEST:
            self.root.attributes("-fullscreen", True)
        self.fullscreen = not TEST

        top = tk.Frame(self.root, bg=SURFACE, height=52)
        top.pack(fill="x", side="top")
        top.pack_propagate(False)

        self._button(top, "‹", self.prev_week, width=3).pack(side="left", padx=(8, 2), pady=8)
        self._button(top, "›", self.next_week, width=3).pack(side="left", padx=2, pady=8)
        self.range_label = tk.Label(top, bg=SURFACE, fg=TEXT, font=self.font_bold)
        self.range_label.pack(side="left", padx=(8, 6))
        self._button(top, "Today", self.go_today).pack(side="left", padx=2, pady=8)
        self._button(top, "Big", self.open_today_big, width=5).pack(side="left", padx=2, pady=8)
        self._button(top, "↶", self.on_undo, width=3).pack(side="left", padx=2, pady=8)
        self._button(top, "↷", self.on_redo, width=3).pack(side="left", padx=2, pady=8)
        self._button(top, "Find", self.open_search, width=5).pack(side="left", padx=2, pady=8)
        self._button(top, "Rules", self.open_recurring, width=5).pack(side="left", padx=2, pady=8)
        self._button(top, "Mini", self.toggle_mini, width=5).pack(side="left", padx=2, pady=8)
        self._button(top, "Theme", self.cycle_theme, width=6).pack(side="left", padx=2, pady=8)

        self.status_label = tk.Label(top, text="Saved locally", bg=SURFACE, fg=MUTED, font=self.font_small, anchor="e")
        self.status_label.pack(side="left", fill="x", expand=True, padx=10)

        self._button(top, "Copy", self.copy_day, width=5).pack(side="left", padx=2, pady=8)
        self._button(top, "Print", self.print_week).pack(side="left", padx=2, pady=8)
        self._button(top, "↻", lambda: self.start_sync(False), width=3).pack(side="left", padx=2, pady=8)
        self._button(top, "⚙", self.open_settings, width=3).pack(side="left", padx=2, pady=8)
        self._button(top, "⛶", self.toggle_fullscreen, width=3).pack(side="left", padx=2, pady=8)
        self._button(top, "✕", self.quit_app, width=3).pack(side="left", padx=(2, 8), pady=8)

        main = tk.Frame(self.root, bg=BG)
        main.pack(fill="both", expand=True)

        tabs = tk.Frame(main, bg=BG, width=30)
        tabs.pack(side="left", fill="y", padx=(4, 2), pady=12)
        tabs.pack_propagate(False)
        self.month_tabs = []
        for index, label in enumerate(MONTHS_SHORT):
            button = tk.Label(
                tabs, text=label, bg=BG, fg=MUTED, font=self.font_small,
                cursor="hand2", padx=2, pady=3,
            )
            button.pack(fill="x")
            button.bind("<Button-1>", lambda _e, m=index + 1: self.go_to_month(m))
            self.month_tabs.append(button)

        self.canvas = tk.Canvas(main, bg=BG, highlightthickness=0)
        scroll = tk.Scrollbar(main, orient="vertical", command=self.canvas.yview, width=12)
        scroll.pack(side="right", fill="y")
        self.canvas.configure(yscrollcommand=scroll.set)
        self.canvas.pack(side="left", fill="both", expand=True)

        self.inner = tk.Frame(self.canvas, bg=BG)
        self.window = self.canvas.create_window((0, 0), window=self.inner, anchor="nw")
        self.inner.bind("<Configure>", lambda _e: self.canvas.configure(scrollregion=self.canvas.bbox("all")))
        self.canvas.bind("<Configure>", self._size_pages)
        self.canvas.bind_all("<MouseWheel>", self._wheel)

        # An open book: two cream pages, a soft shadow and a centre fold.
        self.inner.columnconfigure(0, weight=1)
        self.inner.columnconfigure(1, weight=0, minsize=18)
        self.inner.columnconfigure(2, weight=1)
        self.inner.rowconfigure(0, weight=1)

        left_shadow = tk.Frame(self.inner, bg=SHADOW)
        left_shadow.grid(row=0, column=0, sticky="nsew", padx=(16, 4), pady=(18, 6))
        left = tk.Frame(self.inner, bg=SURFACE, highlightthickness=1, highlightbackground=BORDER)
        left.grid(row=0, column=0, sticky="nsew", padx=(12, 12), pady=(12, 14))

        spine = tk.Frame(self.inner, bg=SPINE, width=18)
        spine.grid(row=0, column=1, sticky="ns", pady=(12, 14))
        fold = tk.Frame(spine, bg=SHADOW, width=2)
        fold.place(relx=0.5, rely=0, relheight=1, anchor="n")

        right_shadow = tk.Frame(self.inner, bg=SHADOW)
        right_shadow.grid(row=0, column=2, sticky="nsew", padx=(16, 4), pady=(18, 6))
        right = tk.Frame(self.inner, bg=SURFACE, highlightthickness=1, highlightbackground=BORDER)
        right.grid(row=0, column=2, sticky="nsew", padx=(12, 12), pady=(12, 14))

        for page in (left, right):
            page.rowconfigure(0, weight=1)
        for column in range(3):
            left.columnconfigure(column, weight=10, uniform="leftpage")
        for column in (0, 1):
            right.columnconfigure(column, weight=10, uniform="rightpage")
        right.columnconfigure(2, weight=7, minsize=200)

        for page in (left, right):
            for column in (1, 2):
                separator = tk.Frame(page, bg=BORDER, width=1)
                separator.grid(row=0, column=column, sticky="nsw")

        for col in range(3):
            self._build_day(col, parent=left, column=col)
        for col in (3, 4):
            self._build_day(col, parent=right, column=col - 3)

        weekend = tk.Frame(right, bg=SURFACE)
        weekend.grid(row=0, column=2, sticky="nsew")
        weekend.columnconfigure(0, weight=1)
        weekend.rowconfigure(0, weight=1)
        weekend.rowconfigure(1, weight=1)
        weekend_sep = tk.Frame(weekend, bg=BORDER, height=1)
        weekend_sep.grid(row=1, column=0, sticky="nw")
        self._build_day(5, parent=weekend, row=0, column=0, compact=True)
        self._build_day(6, parent=weekend, row=1, column=0, compact=True)

    def _size_pages(self, event) -> None:
        self.canvas.itemconfig(self.window, width=event.width, height=event.height)

    def _compact_wheel(self, event, scroller: tk.Canvas | None = None) -> str:
        target = scroller if scroller is not None else event.widget
        target.yview_scroll(-1 if event.delta > 0 else 1, "units")
        return "break"

    def _button(self, parent, text: str, command, width: int | None = None) -> tk.Button:
        opts = dict(
            text=text, command=command, bd=0, relief="flat", cursor="hand2",
            bg=SURFACE, fg=TEXT, activebackground="#f3efe4",
            font=self.font_bold, padx=8, pady=2,
        )
        if width is not None:
            opts["width"] = width
        return tk.Button(parent, **opts)

    def _build_day(self, col: int, parent: tk.Misc | None = None, row: int = 0,
                   column: int | None = None, compact: bool = False) -> None:
        parent = parent if parent is not None else self.inner
        column = col if column is None else column
        card = WEEKEND if col >= 5 else SURFACE
        day = tk.Frame(parent, bg=card)
        pady = (0 if row == 0 else 5, 0)
        day.grid(row=row, column=column, sticky="nsew",
                 padx=(6 if column > 0 else 0, 0), pady=pady)

        # Sat/Sun share a half-height card; keep their rows readable by
        # scrolling that page instead of squeezing 29 lines into 400 px.
        content: tk.Misc = day
        scroller: tk.Canvas | None = None
        if compact:
            shell = tk.Frame(day, bg=card)
            shell.pack(fill="both", expand=True)
            hint = tk.Label(
                shell, text="↓ scroll for later times",
                bg=card, fg=MUTED, font=self.font_small,
            )
            hint.pack(side="bottom", fill="x", pady=(0, 2))
            scroller = tk.Canvas(shell, bg=card, highlightthickness=0, width=1, height=1)
            bar = tk.Scrollbar(
                shell, orient="vertical", command=scroller.yview, width=14,
                bg=SHADOW, troughcolor=card, activebackground=MARGIN,
            )
            bar.pack(side="right", fill="y")
            scroller.pack(side="left", fill="both", expand=True)
            scroller.configure(yscrollcommand=bar.set)
            content = tk.Frame(scroller, bg=card)
            window = scroller.create_window((0, 0), window=content, anchor="nw")
            content.bind("<Configure>", lambda _e: scroller.configure(scrollregion=scroller.bbox("all")))
            scroller.bind("<Configure>", lambda e: scroller.itemconfig(window, width=e.width))
            scroller.bind("<MouseWheel>", self._compact_wheel)

        head = tk.Frame(content, bg=card, height=36)
        head.pack(fill="x", padx=(8, 6), pady=(8, 2))
        head.pack_propagate(False)
        name = tk.Label(head, bg=card, fg=TEXT, font=self.font_bold, anchor="w")
        name.pack(side="left")
        clear = tk.Button(
            head, text="✕", command=lambda c=col: self.clear_day(c),
            bd=0, relief="flat", cursor="hand2", bg=card, fg=MUTED,
            activebackground=card, activeforeground=ACCENT,
            font=self.font_small, padx=3, pady=0,
        )
        clear.pack(side="left", padx=(5, 0))
        number = tk.Label(head, bg=card, fg=MUTED, font=self.font_small, anchor="e")
        number.pack(side="right")

        rule = tk.Frame(content, bg=BORDER, height=1)
        rule.pack(fill="x", padx=(8, 6))

        grid = tk.Frame(content, bg=card)
        grid.pack(fill="both", expand=True, padx=(6, 6), pady=(2, 2))
        grid.columnconfigure(2, weight=1)
        grid.columnconfigure(3, weight=0)
        grid.columnconfigure(4, weight=0)

        margin = tk.Frame(grid, bg=MARGIN, width=2)
        margin.grid(row=0, column=1, sticky="ns", rowspan=len(TIMES))

        for index, time_key in enumerate(TIMES):
            is_hour = time_key.endswith(":00")
            font = self.font_hour if is_hour else self.font_time
            label = tk.Label(
                grid, text=time_key, width=5, anchor="e", bg=card,
                fg=HOUR_TEXT if is_hour else MUTED, font=font,
            )
            label.grid(row=index, column=0, sticky="e", padx=(2, 5))
            entry = tk.Entry(
                grid, font=self.font_entry, bd=0, width=14,
                bg=card, fg=INK, insertbackground=ACCENT,
                highlightthickness=1,
                highlightbackground=HOUR_LINE if is_hour else LINE,
                highlightcolor=ACCENT,
            )
            entry.grid(row=index, column=2, sticky="ew", padx=(6, 0))
            entry.bind("<KeyRelease>", lambda _e, c=col, t=time_key: self.on_slot(c, t))
            entry.bind("<<Paste>>", lambda _e, c=col, t=time_key: self.paste_slot(c, t))
            entry.bind("<Double-Button-1>", lambda _e, c=col, t=time_key: self.toggle_done(c, t))
            entry.bind("<FocusIn>", lambda _e, c=col, t=time_key: self.show_last_week(c, t))
            entry.bind("<FocusIn>", lambda _e: self.begin_focus(), add="+")
            entry.bind("<FocusOut>", lambda _e: self.commit_focus(), add="+")
            entry.bind("<Up>", lambda _e, c=col, t=time_key: self.arrow_slot(c, t, -1))
            entry.bind("<Down>", lambda _e, c=col, t=time_key: self.arrow_slot(c, t, 1))
            entry.bind("<Return>", lambda _e, c=col, t=time_key: self.arrow_slot(c, t, 1))
            entry.bind("<Tab>", lambda _e, c=col, t=time_key: self.focus_done(c, t))
            self.slot_widgets[(col, time_key)] = entry

            ghost = tk.Label(
                grid, text="", anchor="w", bg=card, fg=MUTED,
                font=self.font_ghost, padx=4,
            )
            ghost.grid(row=index, column=3, sticky="w")
            self.ghost_labels[(col, time_key)] = ghost

            done = tk.Button(
                grid, text="○", bd=0, relief="flat", bg=card, fg=MUTED,
                activebackground=card, activeforeground=ACCENT,
                font=self.font_small, padx=2, pady=0,
                command=lambda c=col, t=time_key: self.toggle_done(c, t),
            )
            done.grid(row=index, column=4, sticky="e", padx=(0, 4))
            done.bind("<Up>", lambda _e, c=col, t=time_key: self.arrow_done(c, t, -1))
            done.bind("<Down>", lambda _e, c=col, t=time_key: self.arrow_done(c, t, 1))
            done.bind("<Tab>", lambda _e, c=col, t=time_key: self.focus_slot(c, t, 1))
            done.bind("<Return>", lambda _e, c=col, t=time_key: self.focus_slot(c, t))
            self.done_widgets[(col, time_key)] = done
            grid.rowconfigure(index, weight=1)

        now_line = tk.Frame(grid, bg=ACCENT, height=2)
        now_line.place_forget()
        self.now_lines[col] = now_line

        last_week = tk.Label(
            content, text="", anchor="w", justify="left", bg=card,
            fg="#a49a8b", font=self.font_ghost, padx=6,
        )
        last_week.pack(fill="x", padx=(6, 6), pady=(2, 0))
        self.lastweek_labels[col] = last_week

        note_label = tk.Label(content, text="NOTES", bg=card, fg=MUTED, font=self.font_small, anchor="w")
        note_label.pack(fill="x", padx=(10, 6), pady=(6, 1))
        notes = tk.Text(
            content, height=2 if compact else 3, width=20, bd=0, bg=card, fg=INK,
            font=self.font_notes, insertbackground=ACCENT,
            highlightthickness=1, highlightbackground=LINE,
            highlightcolor=ACCENT, wrap="word", padx=6, pady=3,
        )
        notes.pack(fill="x", padx=(6, 6), pady=(0, 8))
        notes.bind("<KeyRelease>", lambda _e, c=col: self.on_note(c))
        notes.bind("<<Paste>>", lambda _e, c=col: self.paste_note(c))
        notes.bind("<FocusIn>", lambda _e: self.begin_focus(), add="+")
        notes.bind("<FocusOut>", lambda _e: self.commit_focus(), add="+")
        self.note_widgets[col] = notes

        if scroller is not None:
            def bind_wheel(widget: tk.Misc) -> None:
                for child in widget.winfo_children():
                    child.bind(
                        "<MouseWheel>",
                        lambda e, s=scroller: self._compact_wheel(e, s),
                    )
                    bind_wheel(child)
            bind_wheel(content)

        self.head_widgets.append((name, number, day))

    def render(self) -> None:
        self.week_keys = [iso_day(self.week_start + timedelta(days=i)) for i in range(7)]
        first, last = parse_day(self.week_keys[0]), parse_day(self.week_keys[-1])
        self.range_label.config(
            text=f"Week {iso_week(first)} · {first.day} – {last.day} {MONTHS_SHORT[last.month - 1]} {last.year} · v5"
        )
        for index, button in enumerate(self.month_tabs):
            active = first.month <= index + 1 <= last.month
            button.config(
                fg=ACCENT if active else MUTED,
                font=self.font_bold if active else self.font_small,
            )

        for col, key in enumerate(self.week_keys):
            day = parse_day(key)
            entry = normalize_entry(self.days.get(key))
            name, number, _frame = self.head_widgets[col]
            name.config(text=f"{WEEKDAYS_SHORT[(day.weekday() + 1) % 7]} {day.day} {MONTHS_SHORT[day.month - 1]}")
            number.config(text=str(day_number(day)))

            previous_day = day - timedelta(days=7)
            previous = []
            for time_key, field in normalize_entry(self.days.get(iso_day(previous_day)))["slots"].items():
                if field["text"].strip():
                    previous.append((time_key, field["text"].strip()))
            for item in visible_occurrences(self.templates, self.days, previous_day):
                previous.append((item["time"], item["text"]))
            previous.sort()
            previous_text = "Last week · " + " · ".join(
                f"{time_key} {text}" for time_key, text in previous[:3]
            ) if previous else ""
            self.lastweek_labels[col].config(text=previous_text)

            for time_key in TIMES:
                widget = self.slot_widgets[(col, time_key)]
                field = entry["slots"].get(time_key, {})
                value = str(field.get("text", "")).replace("\r", " ").replace("\n", " ")
                if widget.get() != value:
                    widget.delete(0, "end")
                    widget.insert(0, value)
                done = bool(field.get("done", False))
                widget.config(
                    font=self.font_entry_done if done else self.font_entry,
                    fg=MUTED if done else self.ink,
                )
                self.done_widgets[(col, time_key)].config(
                    text="✓" if done else "○", fg=ACCENT if done else MUTED,
                )
                recurring = visible_occurrences(self.templates, self.days, day, time_key)
                ghost_text = "" if value.strip() else " · ".join(item["text"] for item in recurring)
                ghost = self.ghost_labels[(col, time_key)]
                if ghost.cget("text") != ghost_text:
                    ghost.config(text=ghost_text)

            notes = self.note_widgets[col]
            value = entry["notes"]["text"]
            if notes.get("1.0", "end-1c") != value:
                notes.delete("1.0", "end")
                notes.insert("1.0", value)
            notes.config(fg=self.ink)

        self._draw_now_lines()
        if self.mini_window is not None:
            self._render_mini()

    def _wheel(self, event) -> None:
        self.canvas.yview_scroll(-1 if event.delta > 0 else 1, "units")

    def set_status(self, text: str, kind: str = "") -> None:
        color = ACCENT if kind == "error" else OK if kind == "ok" else MUTED
        self.status_label.config(text=text, fg=color)

    # ---------- Undo and keyboard navigation ----------

    def snapshot(self) -> str:
        return json.dumps(
            {"days": self.days, "templates": self.templates},
            ensure_ascii=False, sort_keys=True,
        )

    def push_undo(self) -> None:
        self.undo_stack.append(self.snapshot())
        if len(self.undo_stack) > 40:
            self.undo_stack.pop(0)
        self.redo_stack.clear()
        self.focus_snapshot = None

    def begin_focus(self) -> None:
        if self.focus_snapshot is None:
            self.focus_snapshot = self.snapshot()

    def commit_focus(self) -> None:
        if self.focus_snapshot is not None and self.focus_snapshot != self.snapshot():
            self.undo_stack.append(self.focus_snapshot)
            if len(self.undo_stack) > 40:
                self.undo_stack.pop(0)
            self.redo_stack.clear()
        self.focus_snapshot = None

    def apply_state(self, state: dict) -> None:
        self.days = state.get("days", {})
        self.templates = normalize_templates(state.get("templates", {}))
        self.focus_snapshot = None
        self.flush()
        self.render()
        self.set_status("Undone", "ok")

    def on_undo(self, _event=None) -> None:
        if _event is not None and isinstance(self.root.focus_get(), (tk.Entry, tk.Text)):
            return  # keep native text undo inside fields
        if not self.undo_stack:
            self.set_status("Nothing to undo")
            return
        self.redo_stack.append(self.snapshot())
        self.apply_state(json.loads(self.undo_stack.pop()))

    def on_redo(self, _event=None) -> None:
        if _event is not None and isinstance(self.root.focus_get(), (tk.Entry, tk.Text)):
            return
        if not self.redo_stack:
            self.set_status("Nothing to redo")
            return
        self.undo_stack.append(self.snapshot())
        self.apply_state(json.loads(self.redo_stack.pop()))
        self.set_status("Redone", "ok")

    def _step_time(self, time_key: str, amount: int) -> str:
        index = TIMES.index(time_key) if time_key in TIMES else 0
        return TIMES[max(0, min(len(TIMES) - 1, index + amount))]

    def arrow_slot(self, col: int, time_key: str, amount: int) -> str:
        self.slot_widgets[(col, self._step_time(time_key, amount))].focus_set()
        return "break"

    def focus_slot(self, col: int, time_key: str, amount: int = 0) -> str:
        self.slot_widgets[(col, self._step_time(time_key, amount))].focus_set()
        return "break"

    def focus_done(self, col: int, time_key: str) -> str:
        self.done_widgets[(col, time_key)].focus_set()
        return "break"

    def arrow_done(self, col: int, time_key: str, amount: int) -> str:
        self.done_widgets[(col, self._step_time(time_key, amount))].focus_set()
        return "break"

    def cycle_theme(self) -> None:
        names = list(THEMES)
        self.set_theme(names[(names.index(self.theme) + 1) % len(names)])

    def set_theme(self, name: str) -> None:
        if name not in THEMES:
            return
        old = {key: globals()[key] for key in THEMES["paper"]}
        self.theme = name
        new = apply_theme(name)
        recolor(self.root, old, new)
        if self.mini_window is not None:
            recolor(self.mini_window, old, new)
            sticky = STICKY.get(self.theme, STICKY["paper"])
            if self.mini_note is not None:
                self.mini_note.config(bg=sticky)
            self._render_mini()
        self.ink = ink_for(self.theme, self.cfg.get("ink", "blue"))
        self.cfg["theme"] = self.theme
        save_settings(self.cfg)
        self.render()
        self.set_status(f"Theme · {THEME_NAMES[self.theme]}", "ok")

    # ---------- Changes ----------

    def on_slot(self, col: int, time_key: str) -> None:
        key = self.week_keys[col]
        entry = normalize_entry(self.days.get(key))
        old = entry["slots"].get(time_key, {})
        entry["slots"][time_key] = {
            "text": self.slot_widgets[(col, time_key)].get(),
            "ts": now_ms(),
            "done": bool(old.get("done", False)),
        }
        self.days[key] = entry
        field = entry["slots"][time_key]
        widget = self.slot_widgets[(col, time_key)]
        widget.config(
            font=self.font_entry_done if field["done"] else self.font_entry,
            fg=MUTED if field["done"] else self.ink,
        )
        if not field["text"].strip():
            for item in visible_occurrences(self.templates, self.days, parse_day(key), time_key):
                self.ghost_labels[(col, time_key)].config(text=item["text"])
        else:
            self.ghost_labels[(col, time_key)].config(text="")
        self.schedule_save()

    def toggle_done(self, col: int, time_key: str) -> None:
        self.push_undo()
        key = self.week_keys[col]
        entry = normalize_entry(self.days.get(key))
        field = entry["slots"].get(time_key, {"text": "", "ts": 0, "done": False})
        field["done"] = not field.get("done", False)
        field["ts"] = now_ms()
        if not field.get("text", "").strip():
            recurring = visible_occurrences(self.templates, self.days, parse_day(key), time_key)
            if recurring:
                field["text"] = recurring[0]["text"]
        entry["slots"][time_key] = field
        self.days[key] = entry
        widget = self.slot_widgets[(col, time_key)]
        widget.delete(0, "end")
        widget.insert(0, field["text"])
        widget.config(
            font=self.font_entry_done if field["done"] else self.font_entry,
            fg=MUTED if field["done"] else self.ink,
        )
        self.ghost_labels[(col, time_key)].config(text="")
        self.done_widgets[(col, time_key)].config(
            text="✓" if field["done"] else "○", fg=ACCENT if field["done"] else MUTED,
        )
        self.flush()

    def show_last_week(self, col: int, time_key: str) -> None:
        previous_day = parse_day(self.week_keys[col]) - timedelta(days=7)
        texts = [
            field["text"].strip()
            for field in normalize_entry(self.days.get(iso_day(previous_day)))["slots"].values()
            if field["text"].strip()
        ]
        texts.extend(item["text"] for item in visible_occurrences(self.templates, self.days, previous_day, time_key))
        if texts:
            self.set_status(f"Last week · {texts[0]}")

    def paste_slot(self, col: int, time_key: str) -> None:
        self.root.after(10, lambda: self.on_slot(col, time_key))

    def on_note(self, col: int) -> None:
        key = self.week_keys[col]
        entry = normalize_entry(self.days.get(key))
        entry["notes"] = {"text": self.note_widgets[col].get("1.0", "end-1c"), "ts": now_ms()}
        self.days[key] = entry
        self.schedule_save()

    def paste_note(self, col: int) -> None:
        self.root.after(10, lambda: self.on_note(col))

    def clear_day(self, col: int) -> None:
        key = self.week_keys[col]
        day = parse_day(key)
        label = f"{WEEKDAYS_SHORT[(day.weekday() + 1) % 7]} {day.day} {MONTHS_SHORT[day.month - 1]}"
        if not messagebox.askyesno("Clear day", f"Clear all entries and notes for {label}?", parent=self.root):
            return
        self.push_undo()
        stamp = now_ms()
        entry = normalize_entry(self.days.get(key))
        entry["slots"] = {time_key: {"text": "", "ts": stamp} for time_key in TIMES}
        entry["notes"] = {"text": "", "ts": stamp}
        # Suppress recurring ghosts for this date only; the rules themselves stay.
        for item in visible_occurrences(self.templates, self.days, day):
            entry["hidden"][item["id"]] = stamp
        self.days[key] = entry
        self.render()
        self.flush()
        self.set_status(f"Cleared {label}")

    def schedule_save(self) -> None:
        if self.local_timer is not None:
            self.root.after_cancel(self.local_timer)
        self.local_timer = self.root.after(400, self.flush)

    def flush(self) -> None:
        if self.local_timer is not None:
            self.root.after_cancel(self.local_timer)
            self.local_timer = None
        save_days(self.days)
        save_templates(self.templates)
        if self.cfg.get("autosave", True) and not TEST:
            self.schedule_sync(5000)

    # ---------- Print ----------

    def print_week(self) -> None:
        """Capture the whole week and print it on one landscape page."""
        try:
            from PIL import ImageGrab
        except ImportError:
            self.set_status("Pillow is needed for printing", "error")
            return

        self.flush()
        temp = Path(os.environ.get("TEMP") or os.environ.get("TMP") or ".")
        image_path = temp / "notities-week.png"
        self.root.lift()
        self.root.attributes("-topmost", True)
        self.root.focus_force()
        self.root.update()
        try:
            bbox = (
                self.inner.winfo_rootx(), self.inner.winfo_rooty(),
                self.inner.winfo_rootx() + self.inner.winfo_width(),
                self.inner.winfo_rooty() + self.inner.winfo_height(),
            )
            image = ImageGrab.grab(bbox=bbox)
            # A small torn-paper edge under the spread.
            from PIL import ImageDraw
            torn = Image.new("RGB", (image.width, image.height + 14), SURFACE)
            torn.paste(image, (0, 0))
            edge = ImageDraw.Draw(torn)
            for x in range(0, image.width, 12):
                depth = 10 if (x // 12) % 2 == 0 else 4
                edge.polygon(
                    [(x, image.height), (x + 6, image.height + depth), (x + 12, image.height)],
                    fill=SURFACE,
                )
            image = torn
            image.save(image_path)
        except Exception as exc:  # noqa: BLE001 - report in the status bar
            self.set_status(f"Print image failed: {exc}", "error")
            return
        finally:
            self.root.attributes("-topmost", False)

        if TEST:
            self.set_status(f"Print image ready: {image_path.name}", "ok")
            return

        if self._send_to_printer(image_path):
            self.set_status("Printed · 1 page · landscape", "ok")
            return

        pdf_path = temp / "notities-week.pdf"
        image.save(pdf_path, "PDF", resolution=150)
        os.startfile(pdf_path)  # type: ignore[attr-defined]
        self.set_status("No printer — PDF opened instead", "error")

    def _send_to_printer(self, image_path: Path) -> bool:
        temp = Path(os.environ.get("TEMP") or os.environ.get("TMP") or ".")
        script_path = temp / "notities-print.ps1"
        script = r'''param([string]$ImagePath)
Add-Type -AssemblyName System.Drawing
$image = [System.Drawing.Image]::FromFile($ImagePath)
$doc = New-Object System.Drawing.Printing.PrintDocument
$doc.DefaultPageSettings.Landscape = $true
$doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(20, 20, 20, 20)
$doc.add_PrintPage({
    param($sender, $e)
    $e.Graphics.DrawImage($image, $e.MarginBounds)
    $e.HasMorePages = $false
})
try {
    $doc.Print()
    Write-Output 'ok'
} finally {
    $image.Dispose()
    $doc.Dispose()
}
'''
        script_path.write_text(script, encoding="utf-8")
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        try:
            result = subprocess.run(
                [
                    "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass",
                    "-File", str(script_path), "-ImagePath", str(image_path),
                ],
                capture_output=True, text=True, timeout=45, creationflags=flags,
            )
            return result.returncode == 0 and "ok" in result.stdout
        except (OSError, subprocess.SubprocessError):
            return False

    def schedule_sync(self, delay: int) -> None:
        if self.sync_timer is not None:
            self.root.after_cancel(self.sync_timer)
        self.set_status("Waiting to sync…")
        self.sync_timer = self.root.after(delay, lambda: self.start_sync(True))

    # ---------- Sync ----------

    def start_sync(self, silent: bool = True) -> None:
        if TEST:
            return
        if self.syncing:
            self.pending_sync = True
            return
        if not self.cfg.get("token") or not self.cfg.get("owner") or not self.cfg.get("repo"):
            if not silent:
                self.set_status("Enter your GitHub settings first", "error")
                self.open_settings()
            return
        self.syncing = True
        self.set_status("Syncing…")
        cfg = dict(self.cfg)
        snapshot = json.loads(json.dumps(self.days))
        rule_snapshot = json.loads(json.dumps(self.templates))
        threading.Thread(
            target=self._worker, args=(cfg, snapshot, rule_snapshot), daemon=True
        ).start()

    def _worker(self, cfg: dict, snapshot: dict, rule_snapshot: dict) -> None:
        try:
            result = sync_once(cfg, snapshot, rule_snapshot)
            self.queue.put(("done", result, cfg, snapshot, rule_snapshot, None))
        except Exception as exc:  # noqa: BLE001 - show message in the status bar
            self.queue.put(("done", None, cfg, snapshot, rule_snapshot, str(exc)))

    def _pump(self) -> None:
        try:
            while True:
                item = self.queue.get_nowait()
                if item[0] == "done":
                    _, result, cfg, snapshot, rule_snapshot, error_text = item
                    self.syncing = False
                    if error_text:
                        self.set_status("Sync failed — click ↻", "error")
                    else:
                        changed = merge_days(self.days, snapshot)
                        changed = merge_templates(self.templates, rule_snapshot) or changed
                        save_days(self.days)
                        save_templates(self.templates)
                        if changed:
                            self.render()
                        self.cfg.update(cfg)
                        save_settings(self.cfg)
                        if result and result.get("status") == "synced":
                            self.set_status("Synced " + datetime.now().strftime("%H:%M"), "ok")
                        else:
                            self.set_status("All synced", "ok")
                    if self.pending_sync:
                        self.pending_sync = False
                        self.schedule_sync(1200)
                elif item[0] == "test":
                    _, ok, message = item
                    if self.test_label is not None:
                        self.test_label.config(text=message, fg=OK if ok else ACCENT)
        except queue.Empty:
            pass
        self.root.after(150, self._pump)

    def poll(self) -> None:
        if self.cfg.get("autosave", True) and self.cfg.get("token"):
            self.start_sync(True)
        self.root.after(60000, self.poll)

    # ---------- Navigation ----------

    def shift_week(self, amount: int) -> None:
        self.flush()
        self.week_start += timedelta(days=7 * amount)
        self.render()
        self.canvas.yview_moveto(0)

    def prev_week(self) -> None:
        self.shift_week(-1)

    def next_week(self) -> None:
        self.shift_week(1)

    def go_today(self) -> None:
        self.flush()
        today = date.today()
        self.week_start = today - timedelta(days=today.weekday())
        self.render()
        self.canvas.yview_moveto(0)

    def toggle_fullscreen(self, _event=None) -> None:
        self.fullscreen = not self.fullscreen
        self.root.attributes("-fullscreen", self.fullscreen)
        if not self.fullscreen:
            self.root.geometry("1280x800+60+40")

    def quit_app(self) -> None:
        self.flush()
        if self.cfg.get("autosave", True) and self.cfg.get("token") and not TEST:
            worker = threading.Thread(
                target=lambda: sync_once(
                    dict(self.cfg),
                    json.loads(json.dumps(self.days)),
                    json.loads(json.dumps(self.templates)),
                ),
                daemon=True,
            )
            worker.start()
            worker.join(timeout=3)
        self.root.destroy()

    # ---------- Extra views ----------

    def open_today_big(self) -> None:
        """A large, read-only card with today's agenda — handy on a second screen."""
        today = date.today()
        key = iso_day(today)
        entry = normalize_entry(self.days.get(key))
        win = tk.Toplevel(self.root)
        win.transient(self.root)
        win.title("Today — Notes")
        win.configure(bg=SURFACE)
        win.geometry("760x620+80+60")

        head_font = tkfont.Font(root=win, family=self.font_entry["family"], size=26, weight="bold")
        head = tk.Label(
            win, text=f"{WEEKDAYS[today.weekday()]} {long_date(today)}",
            bg=SURFACE, fg=TEXT, font=head_font, anchor="w",
        )
        head.pack(fill="x", padx=24, pady=(20, 10))

        body = tk.Frame(win, bg=SURFACE)
        body.pack(fill="both", expand=True, padx=24, pady=(0, 24))
        scroll = tk.Scrollbar(body, orient="vertical", width=14)
        scroll.pack(side="right", fill="y")
        text = tk.Text(
            body, bd=0, relief="flat", bg=SURFACE, fg=self.ink,
            font=self.font_ghost, yscrollcommand=scroll.set, wrap="word",
        )
        text.pack(side="left", fill="both", expand=True)
        scroll.config(command=text.yview)

        font_big = tkfont.Font(root=win, family=self.font_entry["family"], size=22)
        font_label = tkfont.Font(root=win, family=self.font_ui["family"], size=12, weight="bold")
        text.tag_configure("time", font=font_label, foreground=MUTED, spacing1=10)
        text.tag_configure("item", font=font_big, spacing3=6)
        text.tag_configure("done", font=tkfont.Font(root=win, family=self.font_entry["family"], size=22, overstrike=1), foreground=MUTED)
        text.tag_configure("recurring", font=font_big, foreground=MUTED)

        found = False
        for time_key, field in sorted(entry["slots"].items()):
            if not field["text"].strip():
                continue
            found = True
            text.insert("end", f"{time_key}\n", "time")
            text.insert("end", f"{'✓ ' if field['done'] else ''}{field['text'].strip()}\n",
                        "done" if field["done"] else "item")
        for item in visible_occurrences(self.templates, self.days, today):
            if item["time"] in entry["slots"] and entry["slots"][item["time"]]["text"].strip():
                continue
            found = True
            text.insert("end", f"{item['time']}\n", "time")
            text.insert("end", f"{item['text']} (recurring)\n", "recurring")
        if entry["notes"]["text"].strip():
            found = True
            text.insert("end", "\nNotes\n", "time")
            text.insert("end", f"{entry['notes']['text'].strip()}\n", "item")
        if not found:
            text.insert("end", "Nothing planned for today.\n", "recurring")
        text.config(state="disabled")

        tk.Button(
            win, text="Close", command=win.destroy, bd=0, relief="flat",
            bg=ACCENT, fg="white", font=self.font_bold, padx=18, pady=6,
        ).pack(pady=(0, 16))

    def _draw_now_lines(self) -> None:
        minutes = datetime.now().hour * 60 + datetime.now().minute
        visible = 6 * 60 <= minutes <= 20 * 60
        index = max(0, min(len(TIMES) - 1, (minutes - 6 * 60) // 30))
        fraction = ((minutes - 6 * 60) % 30) / 30
        for col, line in self.now_lines.items():
            if not visible:
                line.place_forget()
                continue
            anchor = self.slot_widgets[(col, TIMES[index])]
            row_height = max(anchor.winfo_height(), 1)
            y = anchor.winfo_y() + int(row_height * fraction)
            line.place(x=0, y=y, relwidth=1, height=2)

    def _tick_now(self) -> None:
        self._draw_now_lines()
        self.root.after(60000, self._tick_now)

    def focus_app(self, _event=None) -> None:
        self.root.deiconify()
        self.root.lift()
        self.root.attributes("-topmost", True)
        self.root.after(350, lambda: self.root.attributes("-topmost", False))
        self.go_today()

    def go_to_month(self, month: int) -> None:
        self.flush()
        first = date(self.week_start.year, month, 1)
        self.week_start = first - timedelta(days=first.weekday())
        self.render()
        self.canvas.yview_moveto(0)

    def copy_day(self) -> None:
        today_key = iso_day(date.today())
        key = today_key if today_key in self.week_keys else self.week_keys[0]
        entry = normalize_entry(self.days.get(key))
        lines = [f"{WEEKDAYS_SHORT[(parse_day(key).weekday() + 1) % 7]} {long_date(parse_day(key))}", ""]
        for time_key, field in sorted(entry["slots"].items()):
            if field["text"].strip():
                mark = "✓ " if field["done"] else ""
                lines.append(f"- {time_key} — {mark}{field['text'].strip()}")
        for item in visible_occurrences(self.templates, self.days, parse_day(key)):
            lines.append(f"- {item['time']} — {item['text']} (recurring)")
        if entry["notes"]["text"].strip():
            lines += ["", entry["notes"]["text"].strip()]
        self.root.clipboard_clear()
        self.root.clipboard_append("\n".join(lines))
        self.set_status("Day copied to clipboard", "ok")

    def open_recurring(self) -> None:
        win = tk.Toplevel(self.root)
        win.transient(self.root)
        win.title("Recurring items — Notes")
        win.configure(bg=SURFACE)
        win.resizable(False, False)

        tk.Label(win, text="Recurring items", bg=SURFACE, fg=TEXT,
                 font=self.font_bold).grid(row=0, column=0, columnspan=4, sticky="w", padx=14, pady=(12, 4))

        listing = tk.Listbox(win, width=64, height=6, bd=1, relief="flat",
                             bg="#fafaf8", fg=TEXT, font=self.font_small)
        listing.grid(row=1, column=0, columnspan=4, padx=14)

        days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        text_var = tk.StringVar()
        time_var = tk.StringVar(value="09:00")
        repeat_var = tk.StringVar(value="monthly")
        every_var = tk.StringVar(value="1")
        pattern_var = tk.StringVar(value="date")
        detail_var = tk.StringVar(value="1")
        weekday_var = tk.StringVar(value="Monday")
        skip_var = tk.StringVar()

        def field(row: int, label: str, widget: tk.Misc) -> None:
            tk.Label(win, text=label, bg=SURFACE, fg=MUTED, font=self.font_small,
                     anchor="w").grid(row=row, column=0, sticky="w", padx=(14, 6), pady=3)
            widget.grid(row=row, column=1, columnspan=3, sticky="ew", padx=(0, 14), pady=3)

        field(2, "Text", tk.Entry(win, textvariable=text_var, bd=1, relief="flat",
                                  bg="#fafaf8", fg=TEXT, font=self.font_ui))
        field(3, "Time", tk.OptionMenu(win, time_var, *TIMES))
        field(4, "Repeat", tk.OptionMenu(win, repeat_var, "weekly", "monthly"))
        field(5, "Every", tk.Entry(win, textvariable=every_var, bd=1, relief="flat",
                                   bg="#fafaf8", fg=TEXT, font=self.font_ui))
        field(6, "When", tk.OptionMenu(win, pattern_var, "date", "last", "nth", "weekday"))
        detail_entry = tk.Entry(win, textvariable=detail_var, bd=1, relief="flat",
                                bg="#fafaf8", fg=TEXT, font=self.font_ui)
        field(7, "Day / number", detail_entry)
        field(8, "Weekday", tk.OptionMenu(win, weekday_var, *days))
        field(9, "Skip dates", tk.Entry(win, textvariable=skip_var, bd=1, relief="flat",
                                        bg="#fafaf8", fg=TEXT, font=self.font_ui))

        hint = tk.Label(
            win,
            text="Every N weeks/months starts from the date the rule was made. Monthly: day 1–31, "
                 "last day, or e.g. first Monday. Skip dates: 2026-12-25, 2027-01-01.",
            bg=SURFACE, fg=MUTED, font=self.font_small, justify="left", wraplength=520,
        )
        hint.grid(row=10, column=0, columnspan=4, sticky="w", padx=14, pady=(2, 6))

        def items() -> list[dict]:
            return sorted(
                (t for t in self.templates.values() if not t["deleted"]),
                key=lambda t: (t["repeat"], t["time"], t["text"]),
            )

        def refresh() -> None:
            listing.delete(0, "end")
            for item in items():
                listing.insert("end", f"{item['text']}  ·  {describe_template(item)}")

        def selected() -> dict | None:
            choice = listing.curselection()
            return items()[choice[0]] if choice else None

        def load(_event=None) -> None:
            item = selected()
            if not item:
                return
            text_var.set(item["text"])
            time_var.set(item["time"])
            repeat_var.set(item["repeat"])
            every_var.set(str(item.get("every", 1)))
            weekday_var.set(days[item["weekday"]])
            skip_var.set(", ".join(item.get("skip", [])))
            if item["repeat"] == "weekly":
                pattern_var.set("weekday")
                detail_var.set("1")
            elif item.get("nth"):
                pattern_var.set("nth")
                detail_var.set(str(item["nth"]))
            elif item["day"] == -1:
                pattern_var.set("last")
                detail_var.set("1")
            else:
                pattern_var.set("date")
                detail_var.set(str(item["day"]))

        def clear_form() -> None:
            listing.selection_clear(0, "end")
            text_var.set("")
            time_var.set("09:00")
            repeat_var.set("monthly")
            every_var.set("1")
            pattern_var.set("date")
            detail_var.set("1")
            weekday_var.set("Monday")
            skip_var.set("")

        def save() -> None:
            if not text_var.get().strip():
                self.set_status("Enter a text first", "error")
                return
            try:
                every = max(1, min(52, int(every_var.get().strip())))
                detail = int(detail_var.get().strip())
            except ValueError:
                self.set_status("Use numbers for 'Every' and 'Day / number'", "error")
                return
            repeat = repeat_var.get()
            pattern = pattern_var.get()
            current = selected()
            anchor = (current or {}).get("anchor") or date.today().isoformat()
            if repeat == "weekly":
                weekday, day, nth = days.index(weekday_var.get()), 1, 0
            elif pattern == "last":
                weekday, day, nth = days.index(weekday_var.get()), -1, 0
            elif pattern == "nth":
                weekday, day, nth = days.index(weekday_var.get()), 1, max(-1, min(5, detail))
            else:
                weekday, day, nth = 0, (max(1, min(31, detail)) if detail > 0 else -1), 0
            skip = [item.strip() for item in skip_var.get().split(",") if valid_day(item.strip())]
            self.push_undo()
            item_id = current["id"] if current else f"r{now_ms()}"
            self.templates[item_id] = normalize_templates({
                item_id: {
                    "id": item_id,
                    "text": text_var.get().strip(),
                    "time": time_var.get(),
                    "repeat": repeat,
                    "weekday": weekday,
                    "day": day,
                    "every": every,
                    "anchor": anchor,
                    "nth": nth,
                    "skip": skip,
                    "ts": now_ms(),
                    "deleted": False,
                }
            })[item_id]
            save_templates(self.templates)
            refresh()
            self.render()
            self.flush()
            self.set_status("Recurring item saved", "ok")

        def remove() -> None:
            item = selected()
            if not item:
                return
            self.push_undo()
            self.templates[item["id"]] = {**item, "deleted": True, "ts": now_ms()}
            save_templates(self.templates)
            refresh()
            self.render()
            self.flush()
            self.set_status("Recurring item removed", "ok")

        listing.bind("<<ListboxSelect>>", load)
        refresh()

        buttons = tk.Frame(win, bg=SURFACE)
        buttons.grid(row=11, column=0, columnspan=4, sticky="e", padx=14, pady=12)
        tk.Button(buttons, text="New", command=clear_form, bd=0, relief="flat",
                  bg=SURFACE, fg=TEXT, font=self.font_bold, padx=10).pack(side="left", padx=4)
        tk.Button(buttons, text="Delete", command=remove, bd=0, relief="flat",
                  bg=SURFACE, fg=ACCENT, font=self.font_bold, padx=10).pack(side="left", padx=4)
        tk.Button(buttons, text="Save item", command=save, bd=0, relief="flat",
                  bg=ACCENT, fg="white", font=self.font_bold, padx=12).pack(side="left", padx=4)
        tk.Button(buttons, text="Close", command=win.destroy, bd=0, relief="flat",
                  bg=SURFACE, fg=TEXT, font=self.font_bold, padx=10).pack(side="left", padx=4)

    def open_search(self) -> None:
        win = tk.Toplevel(self.root)
        win.transient(self.root)
        win.title("Search — Notes")
        win.configure(bg=SURFACE)
        win.geometry("620x460")

        query = tk.StringVar()
        tk.Entry(win, textvariable=query, bd=1, relief="flat", bg="#fafaf8",
                 fg=TEXT, font=self.font_ui).pack(fill="x", padx=14, pady=12)

        tags = set()
        for stored in self.days.values():
            entry = normalize_entry(stored)
            texts = [entry["notes"]["text"]] + [f["text"] for f in entry["slots"].values()]
            for text in texts:
                for token in str(text).split():
                    if token.startswith("#"):
                        tags.add(token.strip(".,;:!?()[]").lower())
        tag_text = "Tags: " + " ".join(sorted(tags)[:12]) if tags else "Tip: type #tag to filter by tag"
        tk.Label(win, text=tag_text, bg=SURFACE, fg=MUTED, font=self.font_small,
                 anchor="w", wraplength=580, justify="left").pack(fill="x", padx=14, pady=(0, 8))

        results = tk.Listbox(win, bd=1, relief="flat", bg="#fafaf8", fg=TEXT,
                             font=self.font_small)
        results.pack(fill="both", expand=True, padx=14, pady=(0, 14))

        def matches() -> list[tuple[str, str]]:
            raw = query.get().strip().lower()
            tag = raw if raw.startswith("#") else ""
            needle = "" if tag else raw

            def ok(text: str, key: str) -> bool:
                haystack = f"{text} {key}".lower()
                if tag:
                    return tag in haystack
                return not needle or needle in haystack

            found = []
            for key in sorted(self.days, reverse=True):
                entry = normalize_entry(self.days[key])
                for time_key, field in sorted(entry["slots"].items()):
                    text = field["text"].strip()
                    if text and ok(text, key):
                        found.append((key, f"{key} · {time_key} — {text}"))
                text = entry["notes"]["text"].strip()
                if text and ok(text, key):
                    found.append((key, f"{key} · Notes — {text[:90]}"))
            return found

        def refresh() -> None:
            results.delete(0, "end")
            for _key, label in matches()[:150]:
                results.insert("end", label)

        def jump(_event=None) -> None:
            choice = results.curselection()
            if not choice:
                return
            key = matches()[choice[0]][0]
            self.week_start = monday(parse_day(key))
            self.render()
            win.destroy()

        query.trace_add("write", lambda *_a: refresh())
        results.bind("<Double-Button-1>", jump)
        results.bind("<Return>", jump)
        refresh()

    def toggle_mini(self) -> None:
        """A small translucent sticky note with today only, always on top."""
        if self.mini_window is not None:
            self.close_mini()
            return
        win = tk.Toplevel(self.root)
        win.overrideredirect(True)
        win.attributes("-topmost", True)
        win.attributes("-alpha", 0.94)
        win.configure(bg=SHADOW)
        if self.mini_position is None:
            x = max(20, self.root.winfo_screenwidth() - 360)
            y = 120
        else:
            x, y = self.mini_position
        win.geometry(f"330x280+{x}+{y}")
        win.protocol("WM_DELETE_WINDOW", self.close_mini)

        sticky = STICKY.get(self.theme, STICKY["paper"])
        note = tk.Frame(win, bg=sticky, padx=2, pady=2)
        note.pack(fill="both", expand=True, padx=4, pady=4,
                  ipadx=8, ipady=6)
        self.mini_note = note

        head = tk.Frame(note, bg=sticky)
        head.pack(fill="x")
        title = tk.Label(
            head, text="TODAY · " + short_weekday(date.today()).upper(),
            bg=sticky, fg=TEXT, font=self.font_bold, anchor="w", cursor="fleur",
        )
        title.pack(side="left", fill="x", expand=True)
        tk.Button(
            head, text="✕", command=self.close_mini, bd=0, relief="flat",
            bg=sticky, fg=TEXT, activebackground=sticky, activeforeground=ACCENT,
            font=self.font_small, padx=4,
        ).pack(side="right")

        body = tk.Frame(note, bg=sticky)
        body.pack(fill="both", expand=True, pady=(6, 0))
        self.mini_body = body
        self.mini_window = win

        drag = {"x": 0, "y": 0}

        def press(event) -> None:
            drag["x"], drag["y"] = event.x_root, event.y_root

        def move(event) -> None:
            dx, dy = event.x_root - drag["x"], event.y_root - drag["y"]
            drag["x"], drag["y"] = event.x_root, event.y_root
            self.mini_position = (win.winfo_x() + dx, win.winfo_y() + dy)
            win.geometry(f"+{self.mini_position[0]}+{self.mini_position[1]}")

        for widget in (head, title):
            widget.bind("<ButtonPress-1>", press)
            widget.bind("<B1-Motion>", move)

        self._render_mini()
        self.mini_timer = self.root.after(60000, self._tick_mini)

    def close_mini(self) -> None:
        if self.mini_timer is not None:
            self.root.after_cancel(self.mini_timer)
            self.mini_timer = None
        if self.mini_window is not None:
            self.mini_position = (self.mini_window.winfo_x(), self.mini_window.winfo_y())
            self.mini_window.destroy()
        self.mini_window = None
        self.mini_body = None
        self.mini_note = None

    def _tick_mini(self) -> None:
        self._render_mini()
        self.mini_timer = self.root.after(60000, self._tick_mini)

    def _render_mini(self) -> None:
        if self.mini_body is None or not self.mini_body.winfo_exists():
            return
        sticky = STICKY.get(self.theme, STICKY["paper"])
        for child in list(self.mini_body.winfo_children()):
            child.destroy()
        today = date.today()
        key = iso_day(today)
        entry = normalize_entry(self.days.get(key))
        rows = []
        for time_key, field in sorted(entry["slots"].items()):
            text = field["text"].strip()
            if text:
                rows.append((time_key, text, bool(field["done"])))
        for item in visible_occurrences(self.templates, self.days, today):
            if item["time"] in entry["slots"] and entry["slots"][item["time"]]["text"].strip():
                continue
            rows.append((item["time"], item["text"], False))
        if not rows:
            empty = tk.Label(
                self.mini_body, text="Nothing planned today.", bg=sticky,
                fg=MUTED, font=self.font_small, anchor="w", justify="left",
            )
            empty.pack(fill="x", pady=8)
            return
        for time_key, text, done in rows[:10]:
            row = tk.Frame(self.mini_body, bg=sticky)
            row.pack(fill="x", pady=2)
            tk.Label(
                row, text=time_key, bg=sticky, fg=MUTED,
                font=self.font_small, width=5, anchor="w",
            ).pack(side="left")
            label = tk.Label(
                row, text=("✓ " if done else "") + text, bg=sticky,
                fg=MUTED if done else TEXT, font=self.font_small,
                anchor="w", justify="left", wraplength=250,
            )
            label.pack(side="left", fill="x", expand=True)

    # ---------- Settings ----------

    def open_settings(self) -> None:
        win = tk.Toplevel(self.root)
        win.transient(self.root)
        win.grab_set()
        win.title("Settings — Notes")
        win.configure(bg=SURFACE)
        win.resizable(False, False)

        fields = [
            ("Username", "owner", "e.g. toshk", False),
            ("Repository", "repo", "e.g. notes", False),
            ("Branch", "branch", "main", False),
            ("Folder", "path", "notities", False),
            ("Access token", "token", "github_pat_…", True),
        ]
        variables = {}
        for row, (label, key, placeholder, secret) in enumerate(fields):
            tk.Label(win, text=label, bg=SURFACE, fg=MUTED, font=self.font_small, anchor="w").grid(
                row=row, column=0, sticky="w", padx=(16, 8), pady=(12 if row == 0 else 4, 0)
            )
            var = tk.StringVar(value=str(self.cfg.get(key, "")))
            entry = tk.Entry(
                win, textvariable=var, width=42, bd=1, relief="flat",
                bg="#fafaf8", fg=TEXT, font=self.font_ui,
                show="•" if secret else "",
            )
            entry.grid(row=row, column=1, columnspan=2, sticky="ew", padx=(0, 16), pady=(12 if row == 0 else 4, 0))
            variables[key] = var

        ink_var = tk.StringVar(value=self.cfg.get("ink", "blue"))
        theme_var = tk.StringVar(
            value=THEME_NAMES.get(self.cfg.get("theme", "paper"), "Paper")
        )
        for row, label, menu in (
            (5, "Ink", tk.OptionMenu(win, ink_var, "blue", "black", "gray")),
            (6, "Paper", tk.OptionMenu(win, theme_var, *THEME_NAMES.values())),
        ):
            tk.Label(win, text=label, bg=SURFACE, fg=MUTED, font=self.font_small,
                     anchor="w").grid(row=row, column=0, sticky="w", padx=(16, 8), pady=(8, 0))
            menu.grid(row=row, column=1, columnspan=2, sticky="w", padx=(0, 16), pady=(8, 0))

        autosave = tk.BooleanVar(value=bool(self.cfg.get("autosave", True)))
        tk.Checkbutton(
            win, text="Automatically sync with GitHub", variable=autosave,
            bg=SURFACE, fg=TEXT, activebackground=SURFACE, font=self.font_ui,
            anchor="w", highlightthickness=0,
        ).grid(row=7, column=0, columnspan=3, sticky="w", padx=14, pady=(14, 2))

        hint = (
            "Use the same token and repository as on your iPhone. The token is encrypted with\n"
            "Windows DPAPI before it is written to settings.json. Agenda data stays in sync."
        )
        tk.Label(win, text=hint, bg="#f6f5f2", fg="#6b6f74", font=self.font_small,
                 justify="left", padx=8, pady=6).grid(row=8, column=0, columnspan=3, sticky="ew", padx=16, pady=8)

        self.test_label = tk.Label(win, text="", bg=SURFACE, fg=MUTED, font=self.font_small, anchor="w")
        self.test_label.grid(row=9, column=0, columnspan=3, sticky="ew", padx=16)

        def current_cfg() -> dict:
            name = next(
                (key for key, label in THEME_NAMES.items() if label == theme_var.get()), "paper"
            )
            return {
                "owner": variables["owner"].get().strip(),
                "repo": variables["repo"].get().strip().removesuffix(".git"),
                "branch": variables["branch"].get().strip() or "main",
                "path": variables["path"].get().strip().strip("/") or "notities",
                "token": variables["token"].get().strip(),
                "autosave": bool(autosave.get()),
                "lastSignature": self.cfg.get("lastSignature", ""),
                "lastBackup": self.cfg.get("lastBackup", ""),
                "ink": ink_var.get(),
                "theme": name,
            }

        def do_test() -> None:
            cfg = current_cfg()
            self.test_label.config(text="Connecting…", fg=MUTED)
            threading.Thread(
                target=lambda: self.queue.put(("test", *test_connection(cfg))), daemon=True
            ).start()

        def close() -> None:
            self.test_label = None
            win.destroy()

        def do_save() -> None:
            self.cfg = current_cfg()
            name = self.cfg.get("theme", "paper")
            if name != self.theme:
                save_settings(self.cfg)
                close()
                self.set_theme(name)
            else:
                self.ink = ink_for(self.theme, self.cfg.get("ink", "blue"))
                save_settings(self.cfg)
                close()
                self.render()
            self.set_status("Settings saved")
            self.start_sync(True)

        win.protocol("WM_DELETE_WINDOW", close)

        buttons = tk.Frame(win, bg=SURFACE)
        buttons.grid(row=10, column=0, columnspan=3, sticky="e", padx=16, pady=14)
        tk.Button(buttons, text="Check", command=do_test, bd=1, relief="flat", bg="#ffffff",
                  fg=TEXT, font=self.font_bold, padx=12, pady=6).pack(side="left", padx=4)
        tk.Button(buttons, text="Cancel", command=close, bd=1, relief="flat", bg="#ffffff",
                  fg=TEXT, font=self.font_bold, padx=12, pady=6).pack(side="left", padx=4)
        tk.Button(buttons, text="Save", command=do_save, bd=0, relief="flat", bg=ACCENT,
                  fg="#ffffff", font=self.font_bold, padx=14, pady=6).pack(side="left", padx=4)

        win.wait_visibility()
        win.transient(self.root)
        win.focus_force()


def main() -> None:
    root = tk.Tk()
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()
