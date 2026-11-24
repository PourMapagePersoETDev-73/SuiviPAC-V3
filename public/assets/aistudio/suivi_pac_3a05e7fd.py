# -*- coding: utf-8 -*-
"""
Suivi PAC : interface (Tkinter). Lancer ce fichier avec Thonny (bouton ▶) ou le transformer en .exe.
Toute la logique est dans suivi_core.py (à garder dans le même dossier).
"""
import datetime as dt
import tkinter as tk
from tkinter import ttk, filedialog, messagebox, simpledialog
from pathlib import Path

import matplotlib
matplotlib.use("TkAgg")
from matplotlib.figure import Figure
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg

import suivi_core as core

BG, BROWN, NAVY = "#F4F1EA", "#7B5B2E", "#1B2A41"


def fr(x, n=2, signed=False):
    """Nombre au format français (virgule)."""
    if x is None:
        return "–"
    s = f"{x:+,.{n}f}" if signed else f"{x:,.{n}f}"
    return s.replace(",", " ").replace(".", ",")


def parse(s):
    s = s.strip().replace(",", ".")
    return float(s) if s else None


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Suivi PAC")
        self.geometry("1220x800")
        self.configure(bg=BG)
        self.cfg = core.load_json(core.CONFIG_FILE, {})
        self.ref, self.entries, self.model = None, {}, None
        self.vars = {k: tk.StringVar() for k in core.FIELDS}
        self.date_var = tk.StringVar()
        self._loading = False
        self._menu()
        self._ui()
        self.protocol("WM_DELETE_WINDOW", self._quit)
        self.after(150, self.startup)

    # ------------------------------------------------------------------ interface
    def _menu(self):
        m = tk.Menu(self)
        f = tk.Menu(m, tearoff=0)
        f.add_command(label="Choisir le fichier Excel…", command=self.choose_excel)
        f.add_command(label="Relire les saisies depuis Excel (écrase l'appli)…", command=self.import_from_excel)
        f.add_command(label="Écrire dans le fichier Excel", command=self.write_excel)
        f.add_separator()
        f.add_command(label="Quitter", command=self._quit)
        m.add_cascade(label="Fichier", menu=f)
        t = tk.Menu(m, tearoff=0)
        t.add_command(label="Générer la page mobile", command=self.make_mobile)
        t.add_command(label="Partager sur le Wi-Fi (téléphone)", command=self.share_wifi)
        t.add_command(label="Choisir un dossier partagé (OneDrive, Drive…)", command=self.choose_share_folder)
        t.add_separator()
        t.add_command(label="Publier en ligne (GitHub Pages)", command=self.publish_online)
        t.add_command(label="Configurer la publication en ligne…", command=self.config_publish)
        m.add_cascade(label="Téléphone", menu=t)
        self.config(menu=m)

    def _ui(self):
        nb = ttk.Notebook(self)
        nb.pack(fill="both", expand=True, padx=8, pady=8)
        self.tab_in = tk.Frame(nb, bg=BG)
        self.tab_dash = tk.Frame(nb, bg=BG)
        nb.add(self.tab_in, text="  Saisie du jour  ")
        nb.add(self.tab_dash, text="  Suivi  ")
        self.nb = nb
        nb.bind("<<NotebookTabChanged>>", lambda e: self.refresh())
        self._build_input()
        self._build_dash()
        self.status = tk.StringVar(value="Démarrage…")
        tk.Label(self, textvariable=self.status, anchor="w", bg="#E6E0D2", fg="#333").pack(fill="x", side="bottom")

    def _build_input(self):
        left = tk.Frame(self.tab_in, bg=BG)
        left.pack(side="left", fill="y", padx=20, pady=20)
        tk.Label(left, text="Saisie du jour", font=("Segoe UI", 16, "bold"), bg=BG, fg=NAVY).grid(row=0, column=0, columnspan=4, sticky="w", pady=(0, 12))
        tk.Label(left, text="Date (jj/mm/aaaa)", bg=BG).grid(row=1, column=0, sticky="w", pady=4)
        e = tk.Entry(left, textvariable=self.date_var, width=14, font=("Segoe UI", 11))
        e.grid(row=1, column=1, sticky="w")
        e.bind("<Return>", lambda ev: self.load_day())
        e.bind("<FocusOut>", lambda ev: self.load_day())
        bar = tk.Frame(left, bg=BG)
        bar.grid(row=1, column=2, columnspan=2, sticky="w", padx=6)
        for txt, d in (("◄", -1), ("►", 1)):
            tk.Button(bar, text=txt, width=3, command=lambda d=d: self.shift_day(d)).pack(side="left", padx=1)
        tk.Button(bar, text="Aujourd'hui", command=self.go_today).pack(side="left", padx=4)
        row = 2
        for k in core.FIELDS:
            tk.Label(left, text=core.LABELS[k], bg=BG).grid(row=row, column=0, sticky="w", pady=4)
            ent = tk.Entry(left, textvariable=self.vars[k], width=34 if k == "remarque" else 14, font=("Segoe UI", 11))
            ent.grid(row=row, column=1, columnspan=3 if k == "remarque" else 1, sticky="w")
            self.vars[k].trace_add("write", lambda *a: self.preview())
            row += 1
        b = tk.Frame(left, bg=BG)
        b.grid(row=row, column=0, columnspan=4, sticky="w", pady=16)
        tk.Button(b, text="Enregistrer ce jour", bg=BROWN, fg="white", font=("Segoe UI", 11, "bold"), padx=10, command=self.save_day).pack(side="left", padx=(0, 6))
        tk.Button(b, text="Écrire dans Excel", font=("Segoe UI", 11), padx=8, command=self.write_excel).pack(side="left", padx=3)
        tk.Button(b, text="Publier en ligne", bg="#2E7D32", fg="white", font=("Segoe UI", 11, "bold"), padx=8, command=self.publish_online).pack(side="left", padx=3)
        tk.Button(b, text="Page mobile", font=("Segoe UI", 11), padx=8, command=self.make_mobile).pack(side="left", padx=3)
        tk.Label(left, text="Champs facultatifs : COP affiché, EDF €, gaz, remarques.\nSi EDF € est vide, il est calculé avec le prix du fichier Excel.",
                 bg=BG, fg="#666", justify="left").grid(row=row + 1, column=0, columnspan=4, sticky="w")
        right = tk.Frame(self.tab_in, bg="white", highlightbackground="#ddd", highlightthickness=1)
        right.pack(side="left", fill="both", expand=True, padx=10, pady=20)
        tk.Label(right, text="Cette journée est-elle normale ?", font=("Segoe UI", 14, "bold"), bg="white", fg=NAVY).pack(anchor="w", padx=16, pady=(12, 2))
        self.verdict_title = tk.Label(right, text="", font=("Segoe UI", 17, "bold"), bg="white", anchor="w")
        self.verdict_title.pack(fill="x", padx=16)
        self.res = tk.Text(right, height=9, bg="white", relief="flat", font=("Segoe UI", 12), wrap="word", cursor="arrow", state="disabled", borderwidth=0)
        self.res.pack(fill="x", padx=16, pady=6)
        for tag, color in (("good", "#2e7d32"), ("bad", "#c62828"), ("mid", "#b26a00"), ("blue", "#1565c0"), ("navy", NAVY)):
            self.res.tag_configure(tag, foreground=color, font=("Segoe UI", 14, "bold"))
        self.fig_day = Figure(figsize=(7.4, 3.3), dpi=96, facecolor="white")
        self.canvas_day = FigureCanvasTkAgg(self.fig_day, master=right)
        self.canvas_day.get_tk_widget().pack(fill="both", expand=True, padx=8, pady=(0, 8))

    def _big_card(self, parent, col, title):
        f = tk.Frame(parent, bg=BROWN)
        f.grid(row=0, column=col, padx=5, sticky="nsew")
        parent.columnconfigure(col, weight=2)
        tk.Label(f, text=title, bg=BROWN, fg="white", font=("Segoe UI", 10, "bold")).pack(anchor="w", padx=12, pady=(8, 0))
        big = tk.Label(f, text="–", bg=BROWN, fg="white", font=("Segoe UI", 26, "bold"))
        big.pack(anchor="w", padx=12)
        sub = tk.Label(f, text="", bg=BROWN, fg="#F0E6D2", font=("Segoe UI", 10), justify="left")
        sub.pack(anchor="w", padx=12)
        bar = ttk.Progressbar(f, maximum=100, length=260)
        bar.pack(anchor="w", padx=12, pady=(4, 10))
        return {"big": big, "sub": sub, "bar": bar}

    def _small_card(self, parent, col, title):
        f = tk.Frame(parent, bg=NAVY)
        f.grid(row=0, column=col, padx=5, sticky="nsew")
        parent.columnconfigure(col, weight=1)
        tk.Label(f, text=title, bg=NAVY, fg="white", font=("Segoe UI", 9)).pack(anchor="w", padx=12, pady=(8, 0))
        big = tk.Label(f, text="–", bg=NAVY, fg="white", font=("Segoe UI", 13, "bold"), wraplength=190, justify="left")
        big.pack(anchor="w", padx=12, pady=(2, 0))
        sub = tk.Label(f, text="", bg=NAVY, fg="#C9D3E3", font=("Segoe UI", 9), wraplength=190, justify="left")
        sub.pack(anchor="w", padx=12, pady=(0, 8))
        return {"big": big, "sub": sub}

    def _build_dash(self):
        cards = tk.Frame(self.tab_dash, bg=BG)
        cards.pack(fill="x", padx=8, pady=8)
        self.c_eco = self._big_card(cards, 0, "Économie cumulée vs N-1  (année de chauffage)")
        self.c_ben = self._big_card(cards, 1, "Bénéfice vs N-1")
        self.c_last = self._small_card(cards, 2, "Dernier jour saisi")
        self.c_days = self._small_card(cards, 3, "Jours saisis")
        wrap = tk.Frame(self.tab_dash, bg=BG)
        wrap.pack(fill="both", expand=True)
        self.sc = tk.Canvas(wrap, bg=BG, highlightthickness=0)
        sb = ttk.Scrollbar(wrap, orient="vertical", command=self.sc.yview)
        self.sc.configure(yscrollcommand=sb.set)
        sb.pack(side="right", fill="y")
        self.sc.pack(side="left", fill="both", expand=True)
        inner = tk.Frame(self.sc, bg=BG)
        win = self.sc.create_window((0, 0), window=inner, anchor="nw")
        inner.bind("<Configure>", lambda e: self.sc.configure(scrollregion=self.sc.bbox("all")))
        self.sc.bind("<Configure>", lambda e: self.sc.itemconfig(win, width=e.width))
        self.sc.bind("<Enter>", lambda e: self.sc.bind_all("<MouseWheel>", lambda ev: self.sc.yview_scroll(int(-ev.delta / 120), "units")))
        self.sc.bind("<Leave>", lambda e: self.sc.unbind_all("<MouseWheel>"))
        self.fig = Figure(figsize=(11.5, 13), dpi=96, facecolor="white")
        self.canvas = FigureCanvasTkAgg(self.fig, master=inner)
        self.canvas.get_tk_widget().pack(fill="x", padx=4, pady=4)

    # ------------------------------------------------------------------ données
    def data_path(self):
        return core.data_file(self.cfg)

    def startup(self):
        path = self.cfg.get("excel")
        if not path or not Path(path).exists():
            messagebox.showinfo("Suivi PAC", "Choisissez votre fichier Excel de suivi (Suivi_PAC.xlsx).")
            path = filedialog.askopenfilename(title="Fichier Excel de suivi", filetypes=[("Excel", "*.xlsx")])
            if not path:
                self.status.set("Aucun fichier Excel choisi : menu Fichier > Choisir le fichier Excel…")
                return
            self.cfg["excel"] = path
            core.save_json(core.CONFIG_FILE, self.cfg)
        self.reload_all()

    def choose_excel(self):
        path = filedialog.askopenfilename(title="Fichier Excel de suivi", filetypes=[("Excel", "*.xlsx")])
        if path:
            self.cfg["excel"] = path
            core.save_json(core.CONFIG_FILE, self.cfg)
            self.reload_all()

    def reload_all(self, overwrite=False):
        path = self.cfg["excel"]
        try:
            self.status.set("Lecture du fichier Excel…")
            self.update_idletasks()
            self.ref = core.load_reference(path)
            xl = core.read_journal(path)
        except Exception as e:
            messagebox.showerror("Lecture impossible", f"{e}\n\nSi le fichier est ouvert dans Excel, fermez-le.")
            self.status.set("Erreur de lecture du fichier Excel")
            return
        saved = core.load_json(self.data_path(), {})
        legacy = core.load_json(core.DATA_FILE, {}) if core.DATA_FILE != self.data_path() else {}
        saved = core.merge_entries(saved, legacy)            # reprend les anciennes saisies rangées à côté du programme
        saved = core.merge_entries(saved, xl, overwrite=overwrite)
        self.entries = saved
        core.save_json(self.data_path(), self.entries)
        self.go_today()
        self.refresh()
        n_edf = sum(1 for e in self.entries.values() if e.get("edf_kwh") is not None or e.get("edf_eur") is not None)
        self.status.set(f"{len(self.entries)} jours en mémoire ({n_edf} avec l'EDF saisi) — Excel : {path} — saisies : {self.data_path()}")

    def import_from_excel(self):
        if messagebox.askyesno("Relire Excel", "Les valeurs du fichier Excel vont remplacer celles de l'appli pour les mêmes dates. Continuer ?"):
            self.reload_all(overwrite=True)

    # ------------------------------------------------------------------ saisie
    def current_date(self):
        d = core.to_date(self.date_var.get())
        if d is None:
            raise ValueError("Date invalide : écrire jj/mm/aaaa")
        return d

    def go_today(self):
        self.date_var.set(core.fmt_date(dt.date.today()))
        self.load_day()

    def shift_day(self, delta):
        try:
            d = self.current_date() + dt.timedelta(days=delta)
        except ValueError:
            d = dt.date.today()
        self.date_var.set(core.fmt_date(d))
        self.load_day()

    def load_day(self):
        try:
            d = self.current_date()
        except ValueError:
            return
        e = self.entries.get(d.isoformat(), {})
        self._loading = True
        for k in core.FIELDS:
            v = e.get(k)
            self.vars[k].set("" if v is None else (v if k == "remarque" else str(v).replace(".", ",")))
        self._loading = False
        self.preview()

    def form_entry(self):
        e = {}
        for k in core.FIELDS:
            s = self.vars[k].get()
            if k == "remarque":
                e[k] = s.strip() or None
            else:
                try:
                    e[k] = parse(s)
                except ValueError:
                    raise ValueError(f"Valeur invalide pour « {core.LABELS[k]} » : {s}")
        return e

    def show_lines(self, lines):
        """lines : liste de lignes, chaque ligne = liste de (texte, tag) ; tag None = texte normal."""
        self.res.config(state="normal")
        self.res.delete("1.0", "end")
        for i, line in enumerate(lines):
            for txt, tag in line:
                self.res.insert("end", txt, tag if tag else ())
            if i < len(lines) - 1:
                self.res.insert("end", "\n")
        self.res.config(state="disabled")

    def preview(self):
        if self._loading or self.ref is None:
            return
        try:
            d = self.current_date()
            e = self.form_entry()
        except ValueError as err:
            self.verdict_title.config(text="", fg="#c62828")
            self.show_lines([[(str(err), None)]])
            return
        has_edf = e["edf_kwh"] is not None or e["edf_eur"] is not None
        if not has_edf:
            self.verdict_title.config(text="Saisissez l'énergie EDF du jour", fg="#666")
            self.show_lines([[("Le verdict compare la dépense EDF du jour à l'an dernier\net à la moyenne des années précédentes (gaz + élec, ±3 jours).", None)]])
            self._schedule_day_chart(None)
            return
        r = core.compute_day(self.ref, d, e)
        P = self.ref.params
        col = {"Moins": "#2e7d32", "Plus": "#c62828"}.get(r["verdict"].split(" ")[0], "#b26a00")
        self.verdict_title.config(text=r["verdict"] or "Pas de référence pour cette date", fg=col)
        better = lambda b: "good" if b is not None and b >= 0 else "bad"
        L = [[("Dépense du jour (EDF) : ", None), (f"{fr(r['depense'])} €", better(r["benef_n1"] if r["benef_n1"] is not None else r["benef_mean"]))]]
        if r["ref_n1"] is not None:
            L.append([("Même jour l'an dernier (gaz + élec) : ", None), (f"{fr(r['ref_n1'])} €", "navy"),
                      ("   bénéfice ", None), (f"{fr(r['benef_n1'] * 100, 0, True)} %", better(r["benef_n1"]))])
        if r["ref_mean"] is not None:
            L.append([("Moyenne des années précédentes : ", None), (f"{fr(r['ref_mean'])} €", "navy"),
                      ("   bénéfice ", None), (f"{fr(r['benef_mean'] * 100, 0, True)} %", better(r["benef_mean"]))])
        if r["eco_n1"] is not None:
            L.append([("Économie du jour vs N-1 : ", None), (f"{fr(r['eco_n1'], 2, True)} €", better(r["eco_n1"]))])
        if r["cop"] is not None:
            rent = P["pe"] / (P["pg"] / P["rend"])
            ctag = "good" if r["cop"] >= P["cop_cible"] else ("mid" if r["cop"] >= rent else "bad")
            L.append([("COP réel : ", None), (fr(r["cop"]), ctag), (f"   (cible {fr(P['cop_cible'])}, rentabilité gaz {fr(rent)})", None)])
        if r["hors_pac"] is not None:
            L.append([("Électricité hors PAC : ", None), (f"{fr(r['hors_pac'], 1)} kWh", "navy"),
                      (f"   (années précédentes : {fr(r['elec_ref_kwh'], 1)} kWh au total)", None)])
        if e["temp"] is not None:
            L.append([("Température : ", None), (f"{fr(e['temp'], 1)} °C", "blue"),
                      ((f"   (habituel {fr(r['temp_ref'], 1)} °C)" if r["temp_ref"] is not None else ""), None)])
        self.show_lines(L)
        self._schedule_day_chart(r)

    def _schedule_day_chart(self, r):
        if getattr(self, "_job", None):
            self.after_cancel(self._job)
        self._job = self.after(250, lambda: self._draw_day_chart(r))

    def _draw_day_chart(self, r):
        self._job = None
        if self.model is None:
            return
        core.draw_day_charts(self.fig_day, r, self.model)
        self.canvas_day.draw_idle()

    def save_day(self):
        try:
            d = self.current_date()
            e = self.form_entry()
        except ValueError as err:
            messagebox.showerror("Saisie", str(err))
            return
        if all(e[k] is None for k in core.FIELDS if k != "remarque"):
            messagebox.showwarning("Saisie", "Rien à enregistrer pour ce jour.")
            return
        self.entries[d.isoformat()] = e
        core.save_json(self.data_path(), self.entries)
        self.refresh()
        self.status.set(f"Jour {core.fmt_date(d)} enregistré dans l'appli. Pensez à « Écrire dans Excel ».")

    def write_excel(self):
        path = self.cfg.get("excel")
        if not path:
            return
        try:
            d = self.current_date()
            e = self.form_entry()
            if any(e[k] is not None for k in core.FIELDS if k != "remarque"):
                self.entries[d.isoformat()] = e
                core.save_json(self.data_path(), self.entries)
        except ValueError:
            pass
        try:
            n, nf = core.write_excel(path, self.entries)
        except PermissionError as err:
            messagebox.showerror("Excel ouvert", str(err))
            return
        except Exception as err:
            messagebox.showerror("Écriture impossible", str(err))
            return
        msg = f"{n} jours écrits dans la feuille Journal.\nUne sauvegarde a été faite dans le dossier « sauvegardes »."
        if nf:
            msg += "\n\nDates absentes de la feuille Journal (non écrites) :\n" + ", ".join(nf[:15])
        messagebox.showinfo("Excel mis à jour", msg)
        self.status.set("Fichier Excel mis à jour")

    # ------------------------------------------------------------------ suivi
    def refresh(self):
        if self.ref is None:
            return
        self.model = core.build_model(self.ref, self.entries)
        k, last = self.model["kpi"], self.model["last"]
        sgn = lambda x, n=0, u="": "–" if x is None else fr(x, n, True) + u
        pct = lambda x: "–" if x is None else fr(x * 100, 0, True) + " %"
        # économie
        self.c_eco["big"].config(text=sgn(k["eco_cumul"], 0, " €"))
        self.c_eco["sub"].config(text=f"Ce mois : {sgn(k['eco_mois'], 0, ' €')}    Dernier jour : {sgn(k['eco_jour'], 2, ' €')}\n"
                                      f"Objectif de l'année : {fr(k['obj_eur'], 0)} €")
        self.c_eco["bar"]["value"] = max(0, min(100, (k["eco_cumul"] or 0) / k["obj_eur"] * 100))
        # bénéfice
        self.c_ben["big"].config(text=pct(k["benef_cumul"]))
        self.c_ben["sub"].config(text=f"Ce mois : {pct(k['benef_mois'])}    Dernier jour : {pct(k['benef_jour'])}\n"
                                      f"Objectif de l'année : {fr(k['obj_pct'] * 100, 0)} %")
        self.c_ben["bar"]["value"] = max(0, min(100, (k["benef_cumul"] or 0) / k["obj_pct"] * 100))
        # petites cartes
        self.c_last["big"].config(text=(last["verdict"] or "–") if last else "–")
        self.c_last["sub"].config(text=core.fmt_date(last["date"]) if last else "")
        self.c_days["big"].config(text=str(k["jours"]))
        self.c_days["sub"].config(text=f"du {k['hy0']:%d/%m/%Y} au {k['hy1']:%d/%m/%Y}")
        core.draw_dashboard(self.fig, self.model)
        self.canvas.draw_idle()
        self.preview()

    # ------------------------------------------------------------------ téléphone
    def _share_folder(self):
        return self.cfg.get("dossier_partage") or None

    def choose_share_folder(self):
        f = filedialog.askdirectory(title="Dossier synchronisé avec votre téléphone (OneDrive, Google Drive…)")
        if f:
            self.cfg["dossier_partage"] = f
            core.save_json(core.CONFIG_FILE, self.cfg)
            self.make_mobile()

    def make_mobile(self):
        if self.model is None:
            return
        out = core.export_mobile(self.model)
        txt = f"Page créée : {out}"
        if self._share_folder():
            out2 = core.export_mobile(self.model, self._share_folder())
            txt += f"\nCopie dans le dossier partagé : {out2}"
        messagebox.showinfo("Page mobile", txt)

    def share_wifi(self):
        if self.model is None:
            return
        core.export_mobile(self.model)
        try:
            url = core.start_wifi_server()
        except OSError as err:
            messagebox.showerror("Wi-Fi", f"Impossible de démarrer le partage : {err}")
            return
        self.clipboard_clear()
        self.clipboard_append(url)
        messagebox.showinfo("Partage Wi-Fi", f"Sur le téléphone (même Wi-Fi que le PC), ouvrez :\n\n{url}\n\n(adresse copiée dans le presse-papiers)\nLe partage s'arrête quand vous fermez le programme.")

    def config_publish(self):
        user = simpledialog.askstring("Publication", "Votre identifiant GitHub :", initialvalue=self.cfg.get("github_user", ""), parent=self)
        if not user:
            return
        repo = simpledialog.askstring("Publication", "Nom du dépôt GitHub (ex. suivi-pac-x7k2q9) :", initialvalue=self.cfg.get("github_repo", ""), parent=self)
        if not repo:
            return
        token = simpledialog.askstring("Publication", "Jeton d'accès GitHub (commence par github_pat_…).\nLaissez vide pour garder l'ancien :", show="*", parent=self)
        pw = simpledialog.askstring("Publication", "MOT DE PASSE de la page (chiffre la page et data.json).\n"
                                    "Laissez vide pour garder l'actuel.\nTapez - (tiret) pour publier SANS mot de passe :", show="*", parent=self)
        self.cfg["github_user"], self.cfg["github_repo"] = user.strip(), repo.strip()
        if token:
            self.cfg["github_token"] = token.strip()
        if pw == "-":
            self.cfg.pop("github_password", None)
        elif pw:
            self.cfg["github_password"] = pw
        core.save_json(core.CONFIG_FILE, self.cfg)
        messagebox.showinfo("Publication", "Réglages enregistrés. Utilisez maintenant : Téléphone > Publier en ligne.")

    def publish_online(self):
        self.cfg = core.load_json(core.CONFIG_FILE, self.cfg)
        try:
            d = self.current_date()
            e = self.form_entry()
            if any(e[k] is not None for k in core.FIELDS if k != "remarque"):
                self.entries[d.isoformat()] = e
                core.save_json(self.data_path(), self.entries)
                self.refresh()
        except ValueError:
            pass
        if self.model is None:
            return
        if not self.cfg.get("github_password"):
            if not messagebox.askyesno("Aucun mot de passe", "Aucun mot de passe n'est défini : la page et les données seront lisibles par toute personne qui connaît l'adresse.\n\nPublier quand même ?"):
                return
        self.status.set("Publication en cours…")
        self.update_idletasks()
        try:
            url = core.publish_online(self.model, self.cfg)
        except Exception as err:
            self.status.set("Publication impossible")
            messagebox.showerror("Publication en ligne", str(err))
            return
        self.clipboard_clear()
        self.clipboard_append(url)
        self.status.set("Page publiée : " + url)
        messagebox.showinfo("Publication en ligne",
                            f"Page publiée (adresse copiée) :\n{url}\n\nDonnées pour une future appli :\n{url}data.json\n"
                            + ("(page et données chiffrées : mot de passe demandé)\n\n" if self.cfg.get("github_password") else "(NON chiffrées)\n\n") +
                            "Si c'est la première fois, comptez 1 à 2 minutes avant que l'adresse réponde.")

    def _quit(self):
        core.stop_wifi_server()
        self.destroy()


if __name__ == "__main__":
    App().mainloop()
