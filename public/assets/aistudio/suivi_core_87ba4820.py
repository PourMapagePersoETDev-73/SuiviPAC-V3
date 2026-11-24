# -*- coding: utf-8 -*-
"""
Suivi PAC : moteur de calcul, lecture / écriture du fichier Excel, page mobile.
Ce fichier ne contient AUCUNE interface : l'interface est dans suivi_pac.py.
"""
import json, os, re, sys, shutil, zipfile, calendar, socket, threading, functools, base64
import urllib.request, urllib.error
import http.server, socketserver
import datetime as dt
from pathlib import Path
from statistics import mean

import openpyxl
from lxml import etree

# ----------------------------------------------------------------------------
# Emplacements des fichiers de travail (à côté du programme / de l'exe)
# ----------------------------------------------------------------------------
def app_dir():
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent

CONFIG_FILE = app_dir() / "config.json"
DATA_FILE = app_dir() / "donnees_pac.json"
MOBILE_DIR = app_dir() / "mobile"
BACKUP_DIR = app_dir() / "sauvegardes"

FIELDS = ["temp", "pac_conso", "pac_prod", "cop_aff", "edf_kwh", "edf_eur", "gaz_kwh", "remarque"]
LABELS = {
    "temp": "Température ext. (°C)",
    "pac_conso": "PAC : énergie consommée (kWh)",
    "pac_prod": "PAC : chaleur produite (kWh)",
    "cop_aff": "COP affiché par la PAC",
    "edf_kwh": "EDF : énergie totale maison (kWh)",
    "edf_eur": "EDF : dépense (€)",
    "gaz_kwh": "Gaz (kWh) – non compté",
    "remarque": "Remarques",
}

# ----------------------------------------------------------------------------
# Petits outils
# ----------------------------------------------------------------------------
def data_file(cfg):
    """Fichier des saisies : à côté du fichier Excel (partagé entre la version Thonny et l'exe)."""
    if cfg and cfg.get("excel"):
        return Path(cfg["excel"]).with_name("donnees_pac.json")
    return DATA_FILE

def merge_entries(base, new, overwrite=False):
    """Fusionne des saisies champ par champ : une case vide ne supprime jamais une valeur déjà connue."""
    out = {k: dict(v) for k, v in base.items()}
    for k, v in new.items():
        cur = out.setdefault(k, {})
        for f, val in v.items():
            if val is not None and (overwrite or cur.get(f) is None):
                cur[f] = val
            elif f not in cur:
                cur[f] = val
    return out

def load_json(path, default):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default

def save_json(path, obj):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)

def to_date(v):
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    if isinstance(v, str):
        for fmt in ("%d/%m/%Y", "%Y-%m-%d"):
            try:
                return dt.datetime.strptime(v.strip(), fmt).date()
            except ValueError:
                pass
    return None

def to_float(v):
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    try:
        s = str(v).strip().replace(",", ".")
        return float(s) if s != "" else None
    except ValueError:
        return None

def edate(d, months):
    y = d.year + (d.month - 1 + months) // 12
    m = (d.month - 1 + months) % 12 + 1
    return dt.date(y, m, min(d.day, calendar.monthrange(y, m)[1]))

def to_serial(d):
    return (d - dt.date(1899, 12, 30)).days

def fmt_date(d):
    return d.strftime("%d/%m/%Y")

def _norm(s):
    return re.sub(r"\s+", " ", str(s or "")).strip().lower()

HEADER_RULES = {
    "date": lambda h: h == "date",
    "temp": lambda h: h.startswith("temp") and "ext" in h,
    "pac_conso": lambda h: "pac" in h and "conso" in h and "gaz" not in h,
    "pac_prod": lambda h: "pac" in h and "produit" in h,
    "cop_aff": lambda h: "cop" in h and "affich" in h,
    "edf_kwh": lambda h: h.startswith("edf") and "kwh" in h,
    "edf_eur": lambda h: h.startswith("edf") and "€" in h and "retenu" not in h,
    "gaz_kwh": lambda h: h.startswith("gaz") and "kwh" in h and "réf" not in h and "ref" not in h,
    "remarque": lambda h: h.startswith("remarque"),
}

def find_columns(header_cells):
    """header_cells : liste des valeurs de la ligne d'en-têtes -> {champ: index de colonne (0-based)}"""
    cols = {}
    for i, h in enumerate(header_cells):
        h = _norm(h)
        for key, rule in HEADER_RULES.items():
            if key not in cols and h and rule(h):
                cols[key] = i
    return cols

# ----------------------------------------------------------------------------
# Lecture du fichier Excel (valeurs seulement, sans toucher au fichier)
# ----------------------------------------------------------------------------
PARAM_RULES = {   # début du libellé de la colonne A de la feuille Paramètres
    "pe": "prix électricité", "abo": "abonnement électricité", "pg": "prix gaz", "abg": "abonnement gaz",
    "rend": "rendement", "fen": "fenêtre", "tol": "tolérance \"dans", "tolt": "tolérance température",
    "cop_cible": "cop cible", "cop_plancher": "cop plancher", "start": "date de mise en route",
}
PARAM_DEFAULT = {"pe": 0.2227, "abo": 0.35, "pg": 0.11517, "abg": 1.0, "rend": 1.0, "fen": 3, "tol": 0.10,
                 "tolt": 2.0, "cop_cible": 20000 / 5600, "cop_plancher": 2.5, "start": dt.date(2026, 9, 18),
                 "obj_pct": 0.35, "obj_eur": 700.0}

class Reference:
    """Tout ce qui vient de l'Excel et ne change pas à la saisie."""
    def __init__(self):
        self.params = dict(PARAM_DEFAULT)
        self.enedis = {}      # date -> kWh/jour (années précédentes)
        self.gaz = {}         # date 2026 -> kWh/jour (profil gaz)
        self.meteo = {}       # date -> température moyenne
        self.n1_total = {}    # date 2025 -> € gaz+élec réels de l'an dernier (feuille "Ref N-1")
        self.year_n1 = None   # {"labels": [...12 mois oct..sept], "gaz": [...], "elec": [...]} factures de l'an dernier

def load_workbook_values(path):
    return openpyxl.load_workbook(path, data_only=True, read_only=True)

def load_reference(path):
    ref = Reference()
    wb = load_workbook_values(path)
    names = {n.lower(): n for n in wb.sheetnames}
    # Paramètres
    found = set()
    if "paramètres" in names:
        for row in wb[names["paramètres"]].iter_rows(min_row=1, max_row=40, values_only=True):
            if not row or row[0] is None:
                continue
            label = _norm(row[0]).replace("“", '"').replace("”", '"')
            if label.startswith("contrôles"):
                break
            for key, frag in PARAM_RULES.items():
                if key not in found and label.startswith(frag) and len(row) > 1 and row[1] is not None:
                    found.add(key)
                    v = row[1]
                    ref.params[key] = to_date(v) if key == "start" else to_float(v)
                    if ref.params[key] is None:
                        ref.params[key] = PARAM_DEFAULT[key]
    # Données historiques (colonnes A:B Enedis, D:E gaz, G:H météo, à partir de la ligne 4)
    if "données" in names:
        for row in wb[names["données"]].iter_rows(min_row=4, values_only=True):
            row = list(row) + [None] * (8 - len(row))
            d, k = to_date(row[0]), to_float(row[1])
            if d and k is not None: ref.enedis[d] = k
            d, k = to_date(row[3]), to_float(row[4])
            if d and k is not None: ref.gaz[d] = k
            d, k = to_date(row[6]), to_float(row[7])
            if d and k is not None: ref.meteo[d] = k
    # Ref N-1 : A = date, J = total € de l'an dernier
    if "ref n-1" in names:
        for row in wb[names["ref n-1"]].iter_rows(min_row=3, values_only=True):
            row = list(row) + [None] * (10 - len(row))
            d, v = to_date(row[0]), to_float(row[9])
            if d and v is not None: ref.n1_total[d] = v
        # tableau mensuel des factures de l'an dernier (lignes GAZ / Élec, colonnes M à X)
        lab = gaz = elec = None
        for row in wb[names["ref n-1"]].iter_rows(min_row=250, max_row=420, values_only=True):
            row = list(row) + [None] * 24
            first = _norm(row[11])
            if first == "gaz" and gaz is None:
                gaz = [to_float(x) for x in row[12:24]]
            elif first in ("élec", "elec") and elec is None:
                elec = [to_float(x) for x in row[12:24]]
            elif lab is None and isinstance(row[12], str) and _norm(row[12]) in ("oct", "octobre"):
                lab = [str(x) for x in row[12:24]]
        if gaz and elec:
            ref.year_n1 = {"labels": lab or ["oct", "nov", "déc", "janv", "févr", "mars", "avr", "mai", "juin", "juil", "août", "sept"],
                           "gaz": gaz, "elec": elec}
    # objectifs de l'année (feuille Verdict du jour : F16 = % , F17 = €)
    if "verdict du jour" in names:
        try:
            ws = wb[names["verdict du jour"]]
            p, e = to_float(ws["F16"].value), to_float(ws["F17"].value)
            if p: ref.params["obj_pct"] = p
            if e: ref.params["obj_eur"] = e
        except Exception:
            pass
    wb.close()
    return ref

def read_journal(path):
    """Lit les saisies de la feuille Journal. Retourne {date_iso: {champ: valeur}}."""
    wb = load_workbook_values(path)
    names = {n.lower(): n for n in wb.sheetnames}
    if "journal" not in names:
        wb.close(); raise ValueError("Feuille « Journal » introuvable dans le fichier Excel.")
    rows = list(wb[names["journal"]].iter_rows(min_row=1, max_row=600, values_only=True))
    wb.close()
    hdr = next((i for i, r in enumerate(rows[:12]) if r and _norm(r[0]) == "date"), None)
    if hdr is None:
        raise ValueError("Ligne d'en-têtes (colonne « Date ») introuvable dans la feuille Journal.")
    cols = find_columns(rows[hdr])
    missing = [LABELS[k] for k in FIELDS if k not in cols]
    if missing:
        raise ValueError("Colonnes introuvables dans Journal : " + ", ".join(missing))
    entries, prev = {}, None
    for r in rows[hdr + 1:]:
        r = list(r) + [None] * 60
        d = to_date(r[0])
        if d is None and prev is not None:
            d = prev + dt.timedelta(days=1)       # fichier sans valeurs en cache
        if d is None:
            continue
        prev = d
        e = {}
        for k in FIELDS:
            v = r[cols[k]]
            e[k] = (str(v) if v not in (None, "") else None) if k == "remarque" else to_float(v)
        if any(e[k] is not None for k in FIELDS if k != "remarque"):
            entries[d.isoformat()] = e
    return entries

# ----------------------------------------------------------------------------
# Calculs
#   - dépense du jour (cette année) = EDF seulement (le gaz n'est plus compté)
#   - références (N-1, N-2, N-3, moyenne) = électricité + gaz de ces années-là
# ----------------------------------------------------------------------------
def win_avg(series, center, w):
    vals = [series[c] for i in range(-w, w + 1) for c in [center + dt.timedelta(days=i)] if c in series]
    return mean(vals) if vals else None

def heating_year(d):
    """Année de chauffage : du 15 septembre au 14 septembre."""
    y = d.year if (d.month, d.day) >= (9, 15) else d.year - 1
    return dt.date(y, 9, 15), dt.date(y + 1, 9, 14)

def compute_day(ref, d, e):
    P = ref.params; w = int(P["fen"])
    r = {"date": d, "entry": e}
    g = e.get
    if g("edf_eur") is not None:
        r["depense"] = g("edf_eur")
    elif g("edf_kwh") is not None:
        r["depense"] = g("edf_kwh") * P["pe"] + P["abo"]
    else:
        r["depense"] = None
    r["total"] = r["depense"]
    r["cop"] = g("pac_prod") / g("pac_conso") if g("pac_prod") is not None and g("pac_conso") else None
    r["hors_pac"] = g("edf_kwh") - g("pac_conso") if g("edf_kwh") is not None and g("pac_conso") is not None else None
    elec_k, tot_k = [], []
    for k in (1, 2, 3):
        c = edate(d, -12 * k)
        el, gz = win_avg(ref.enedis, c, w), win_avg(ref.gaz, c, w)
        elec_k.append(el)
        tot_k.append(el * P["pe"] + P["abo"] + gz * P["pg"] + P["abg"] if el is not None and gz is not None else None)
    n1_real = ref.n1_total.get(edate(d, -12))              # l'an dernier, réel (feuille Ref N-1)
    refs = [n1_real if n1_real is not None else tot_k[0], tot_k[1], tot_k[2]]
    ok = [x for x in refs if x is not None]
    oke = [x for x in elec_k if x is not None]
    r["refs"] = refs
    r["ref_n1"] = refs[0]
    r["ref_mean"] = mean(ok) if ok else None
    r["elec_ref_kwh"] = mean(oke) if oke else None
    pooled = [ref.meteo[c] for k in (1, 2, 3) for i in range(-w, w + 1)
              for c in [edate(d, -12 * k) + dt.timedelta(days=i)] if c in ref.meteo]
    r["temp_ref"] = mean(pooled) if pooled else None
    dep = r["depense"]
    r["eco_n1"] = refs[0] - dep if dep is not None and refs[0] is not None else None
    r["benef_n1"] = 1 - dep / refs[0] if r["eco_n1"] is not None and refs[0] else None
    r["eco_mean"] = r["ref_mean"] - dep if dep is not None and r["ref_mean"] is not None else None
    r["benef_mean"] = 1 - dep / r["ref_mean"] if r["eco_mean"] is not None and r["ref_mean"] else None
    base = r["benef_mean"] if r["benef_mean"] is not None else r["benef_n1"]
    tol = P["tol"]
    if base is None:
        r["verdict"] = ""
    elif base > tol:
        r["verdict"] = "Moins cher que d'habitude"
    elif base < -tol:
        r["verdict"] = "Plus cher que d'habitude"
    else:
        r["verdict"] = "Dans la moyenne"
    return r

def n1_for_curve(ref, d):
    """N-1 (gaz+élec) d'un jour pour la trajectoire annuelle :
    1) valeur réelle jour par jour (feuille Ref N-1), 2) sinon facture mensuelle N-1 répartie sur le mois,
    3) sinon estimation par les kWh (Enedis + gaz) et les prix."""
    v = ref.n1_total.get(edate(d, -12))
    if v is not None:
        return v
    yn = ref.year_n1
    if yn:
        order = [10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9]
        i = order.index(d.month)
        g, e = yn["gaz"][i], yn["elec"][i]
        if g is not None and e is not None:
            return (g + e) / calendar.monthrange(d.year, d.month)[1]
    P = ref.params; w = int(P["fen"]); c = edate(d, -12)
    el, gz = win_avg(ref.enedis, c, w), win_avg(ref.gaz, c, w)
    return el * P["pe"] + P["abo"] + gz * P["pg"] + P["abg"] if el is not None and gz is not None else None

def build_model(ref, entries):
    P = ref.params
    days = [compute_day(ref, dt.date.fromisoformat(k), e) for k, e in sorted(entries.items())]
    dj = [r for r in days if r["depense"] is not None]
    last = dj[-1] if dj else None
    hy0, hy1 = heating_year(last["date"] if last else dt.date.today())
    hy = [r for r in dj if hy0 <= r["date"] <= hy1]
    elig = [r for r in hy if r["eco_n1"] is not None]
    cum = 0.0
    for r in days:
        r["cumul"] = None
    for r in elig:
        cum += r["eco_n1"]
        r["cumul"] = cum
    lm = (last["date"].year, last["date"].month) if last else None
    em = [r for r in elig if (r["date"].year, r["date"].month) == lm]
    lastday = last if last and last["eco_n1"] is not None else None
    mean_or_none = lambda xs: mean(xs) if xs else None
    # mensuel (année de chauffage en cours)
    groups = {}
    for r in hy:
        groups.setdefault((r["date"].year, r["date"].month), []).append(r)
    mlist = []
    for (y, m), rs in sorted(groups.items()):
        n1 = sum(x["ref_n1"] for x in rs) if all(x["ref_n1"] is not None for x in rs) else None
        mm = sum(x["ref_mean"] for x in rs) if all(x["ref_mean"] is not None for x in rs) else None
        reel = sum(x["depense"] for x in rs)
        both = [x for x in rs if x["entry"].get("pac_conso") is not None and x["entry"].get("pac_prod") is not None]
        conso = sum(x["entry"]["pac_conso"] for x in both)
        prod = sum(x["entry"]["pac_prod"] for x in both)
        jm = calendar.monthrange(y, m)[1]
        jm_prec = calendar.monthrange(y - 1, m)[1]
        full = [ref.n1_total.get(dt.date(y - 1, m, d)) for d in range(1, jm_prec + 1)]
        n1_full = sum(full) if all(v is not None for v in full) else None      # facture du mois entier de l'an dernier
        mlist.append({"label": dt.date(y, m, 1).strftime("%m/%Y"), "y": y, "m": m, "jours": len(rs),
                      "jours_mois": jm, "partiel": len(rs) < jm, "ref_n1_full": n1_full,
                      "reel": reel, "total": reel, "ref_n1": n1, "ref_mean": mm,
                      "eco": n1 - reel if n1 is not None else None,
                      "pct_n1": (1 - reel / n1) if n1 else None,
                      "cop": prod / conso if conso else None})
    # trajectoire cumulée : N-1 (gaz+élec) sur toute l'année, objectif, et dépense réelle jusqu'au dernier jour saisi
    traj, cn, cr = [], 0.0, 0.0
    entered = {r["date"]: r for r in hy}
    last_d = last["date"] if last else None
    first_d = min(entered) if entered else None
    for i in range((hy1 - hy0).days + 1):
        d = hy0 + dt.timedelta(days=i)
        n1d = ref.n1_total.get(edate(d, -12)) if (last_d and d <= last_d) else n1_for_curve(ref, d)
        if last_d and d <= last_d:
            r = entered.get(d)
            if r is not None and n1d is not None:          # même règle que l'économie cumulée : jours saisis seulement
                cn += n1d; cr += r["depense"]
        elif n1d is not None:
            cn += n1d                                      # futur : N-1 seul
        traj.append({"date": d, "n1": cn, "obj": cn * (1 - P["obj_pct"]),
                     "reel": cr if (first_d and last_d and first_d <= d <= last_d) else None})
    cops = [r["cop"] for r in days if r["cop"] is not None and r["date"] >= P["start"]]
    kpi = {
        "jours": len(hy), "hy0": hy0, "hy1": hy1,
        "eco_cumul": cum if elig else None,
        "eco_mois": sum(r["eco_n1"] for r in em) if em else None,
        "eco_jour": lastday["eco_n1"] if lastday else None,
        "benef_cumul": mean_or_none([r["benef_n1"] for r in elig]),
        "benef_mois": mean_or_none([r["benef_n1"] for r in em]),
        "benef_jour": lastday["benef_n1"] if lastday else None,
        "obj_eur": P["obj_eur"], "obj_pct": P["obj_pct"],
        "cop_moyen": mean_or_none(cops),
        "cop_rentab": P["pe"] / (P["pg"] / P["rend"]), "cop_cible": P["cop_cible"],
        "mois": mlist[-1] if mlist else None,
    }
    return {"days": days, "hy_days": hy, "months": mlist, "kpi": kpi, "last": last, "params": P, "year_n1": ref.year_n1, "traj": traj}

# ----------------------------------------------------------------------------
# Écriture dans le fichier Excel SANS Excel et SANS abîmer les graphiques :
# on modifie directement le XML de la feuille Journal (le reste du .xlsx est recopié tel quel).
# ----------------------------------------------------------------------------
NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
RNS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PNS = "http://schemas.openxmlformats.org/package/2006/relationships"

def col_letter(i):  # 0-based
    s = ""; i += 1
    while i:
        i, rem = divmod(i - 1, 26); s = chr(65 + rem) + s
    return s

def col_index(letters):
    n = 0
    for ch in letters: n = n * 26 + ord(ch) - 64
    return n - 1

def _sheet_path(z, sheet_name):
    wbx = etree.fromstring(z.read("xl/workbook.xml"))
    rid = None
    for s in wbx.find(f"{{{NS}}}sheets"):
        if s.get("name").lower() == sheet_name.lower():
            rid = s.get(f"{{{RNS}}}id")
    if rid is None: raise ValueError(f"Feuille « {sheet_name} » introuvable.")
    rels = etree.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    for r in rels:
        if r.get("Id") == rid:
            t = r.get("Target")
            return t.lstrip("/") if t.startswith("/") else "xl/" + t
    raise ValueError("Lien de feuille introuvable.")

def _shared_strings(z):
    try:
        root = etree.fromstring(z.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    return ["".join(si.itertext()) for si in root]

def _cell_value(c, sst):
    v = c.find(f"{{{NS}}}v")
    if v is None or v.text is None: return None
    if c.get("t") == "s": return sst[int(v.text)]
    return v.text

def _set_cell(row_el, rownum, col, value):
    ref = f"{col_letter(col)}{rownum}"
    cell = None; insert_at = len(row_el)
    for i, c in enumerate(row_el):
        ci = col_index(re.match(r"[A-Z]+", c.get("r")).group())
        if c.get("r") == ref: cell = c; break
        if ci > col: insert_at = i; break
    if cell is None:
        cell = etree.Element(f"{{{NS}}}c"); cell.set("r", ref); row_el.insert(insert_at, cell)
    if cell.find(f"{{{NS}}}f") is not None:
        return False                                   # on ne touche jamais à une formule
    for ch in list(cell): cell.remove(ch)
    if "t" in cell.attrib: del cell.attrib["t"]
    if isinstance(value, str):
        cell.set("t", "inlineStr")
        is_ = etree.SubElement(cell, f"{{{NS}}}is"); t = etree.SubElement(is_, f"{{{NS}}}t"); t.text = value
        t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    else:
        v = etree.SubElement(cell, f"{{{NS}}}v"); v.text = repr(float(value)) if not float(value).is_integer() else str(int(value))
    return True

def write_excel(path, entries, only_dates=None):
    """Écrit les saisies dans la feuille Journal. Retourne (nb_jours_écrits, [dates non trouvées])."""
    path = Path(path)
    BACKUP_DIR.mkdir(exist_ok=True)
    backup = BACKUP_DIR / f"{path.stem}_{dt.datetime.now():%Y%m%d_%H%M%S}{path.suffix}"
    shutil.copy2(path, backup)
    with zipfile.ZipFile(path) as z:
        sheet_path = _sheet_path(z, "Journal")
        sst = _shared_strings(z)
        root = etree.fromstring(z.read(sheet_path))
        sd = root.find(f"{{{NS}}}sheetData")
        rows = {int(r.get("r")): r for r in sd}
        # repérer l'en-tête et le mapping des colonnes
        hdr_row = None
        for rn in sorted(rows):
            if rn > 12: break
            cells = rows[rn].findall(f"{{{NS}}}c")
            if cells and _norm(_cell_value(cells[0], sst)) == "date": hdr_row = rn; break
        if hdr_row is None: raise ValueError("En-têtes de la feuille Journal introuvables.")
        hdr = {}
        for c in rows[hdr_row].findall(f"{{{NS}}}c"):
            hdr[col_index(re.match(r"[A-Z]+", c.get("r")).group())] = _cell_value(c, sst)
        width = max(hdr) + 1
        cols = find_columns([hdr.get(i) for i in range(width)])
        # date -> numéro de ligne (valeurs de la colonne A, en cache)
        date_rows, first_row = {}, hdr_row + 1
        for rn in sorted(rows):
            if rn <= hdr_row: continue
            ca = next((c for c in rows[rn].findall(f"{{{NS}}}c") if c.get("r") == f"A{rn}"), None)
            if ca is not None:
                val = _cell_value(ca, sst)
                try: date_rows[int(float(val))] = rn
                except (TypeError, ValueError): pass
        first_serial = None
        if first_row in rows:
            ca = next((c for c in rows[first_row].findall(f"{{{NS}}}c") if c.get("r") == f"A{first_row}"), None)
            if ca is not None:
                try: first_serial = int(float(_cell_value(ca, sst)))
                except (TypeError, ValueError): pass
        done, notfound = 0, []
        for iso, e in sorted(entries.items()):
            if only_dates and iso not in only_dates: continue
            d = dt.date.fromisoformat(iso); s = to_serial(d)
            rn = date_rows.get(s)
            if rn is None and first_serial is not None and s >= first_serial:
                guess = first_row + (s - first_serial)
                rn = guess if guess in rows else None
            if rn is None: notfound.append(fmt_date(d)); continue
            for k in FIELDS:
                v = e.get(k)
                if v is None or k not in cols: continue
                _set_cell(rows[rn], rn, cols[k], v)
            done += 1
        new_sheet = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)
        # forcer Excel à tout recalculer à l'ouverture
        wbx = etree.fromstring(z.read("xl/workbook.xml"))
        calc = wbx.find(f"{{{NS}}}calcPr")
        if calc is None:
            calc = etree.Element(f"{{{NS}}}calcPr")
            anchor = wbx.find(f"{{{NS}}}definedNames")
            if anchor is None: anchor = wbx.find(f"{{{NS}}}sheets")
            anchor.addnext(calc)
        calc.set("fullCalcOnLoad", "1")
        new_wb = etree.tostring(wbx, xml_declaration=True, encoding="UTF-8", standalone=True)
        tmp = path.with_suffix(".tmp_suivi")
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as out:
            for item in z.infolist():
                data = z.read(item.filename)
                if item.filename == sheet_path: data = new_sheet
                elif item.filename == "xl/workbook.xml": data = new_wb
                out.writestr(item, data)
    try:
        os.replace(tmp, path)
    except PermissionError:
        os.remove(tmp)
        raise PermissionError("Le fichier Excel est ouvert : fermez-le puis recommencez.")
    return done, notfound

# ----------------------------------------------------------------------------
# Page mobile (HTML autonome, fonctionne sans internet) + partage Wi-Fi
# ----------------------------------------------------------------------------
def _r(x, n=2):
    return None if x is None else round(x, n)

def mobile_payload(model):
    k, last = model["kpi"], model["last"]
    ds = [r for r in model["hy_days"]][-60:]
    allc = [r for r in model["days"] if r["cop"] is not None][-60:]
    obj = k["obj_pct"]
    yn = model.get("year_n1")
    year_n1_data = None
    if yn:
        order = [10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9]
        hy0 = k["hy0"]
        monthly = {m["m"]: m["reel"] for m in model["months"] if not (m["y"] == hy0.year and m["m"] == 9)}
        pac_vals = [monthly.get(mn) for mn in order]
        year_n1_data = {
            "labels": yn["labels"],
            "gaz": [_r(x) for x in yn["gaz"]],
            "elec": [_r(x) for x in yn["elec"]],
            "total_n1": [_r((g or 0) + (e or 0)) for g, e in zip(yn["gaz"], yn["elec"])],
            "pac": [_r(v) for v in pac_vals]
        }
    last_data = None
    if last:
        refs_list = [_r(v) for v in last.get("refs", [])]
        last_data = {
            "date": fmt_date(last["date"]),
            "dep": _r(last["depense"]),
            "ref_n1": _r(last["ref_n1"]),
            "ref_mean": _r(last["ref_mean"]),
            "cop": _r(last["cop"]),
            "verdict": last["verdict"],
            "temp": last["entry"].get("temp"),
            "temp_ref": _r(last["temp_ref"], 1),
            "refs": refs_list,
            "eco_n1": _r(last.get("eco_n1")),
            "benef_n1": _r(last.get("benef_n1"), 3),
            "hors_pac": _r(last.get("hors_pac"), 1),
            "elec_ref_kwh": _r(last.get("elec_ref_kwh"), 1),
        }
    return {
        "maj": dt.datetime.now().strftime("%d/%m/%Y %H:%M"),
        "kpi": {"jours": k["jours"], "hy": f"{k['hy0']:%d/%m/%Y} au {k['hy1']:%d/%m/%Y}",
                "eco": [_r(k["eco_cumul"]), _r(k["eco_mois"]), _r(k["eco_jour"])],
                "benef": [_r(k["benef_cumul"], 3), _r(k["benef_mois"], 3), _r(k["benef_jour"], 3)],
                "obj_eur": k["obj_eur"], "obj_pct": obj, "cop_rentab": _r(k["cop_rentab"]), "cop_cible": _r(k["cop_cible"])},
        "last": last_data,
        "traj": [{"d": t["date"].strftime("%d/%m"), "n1": _r(t["n1"], 1), "obj": _r(t["obj"], 1), "reel": _r(t["reel"], 1)}
                 for t in model.get("traj", [])],
        "mois": [{"l": m["label"] + (f" ({m['jours']}/{m['jours_mois']} j)" if m["partiel"] else ""), "j": m["jours"],
                  "t": _r(m["reel"]), "n1": _r(m["ref_n1"]), "mm": _r(m["ref_mean"]),
                  "n1f": _r(m["ref_n1_full"]) if m["partiel"] else None,
                  "eco": _r(m["eco"]), "cop": _r(m["cop"])} for m in model["months"]],
        "jours": [{"d": r["date"].strftime("%d/%m"), "dep": _r(r["depense"]), "n1": _r(r["ref_n1"]),
                   "obj": _r(r["ref_n1"] * (1 - obj)) if r["ref_n1"] is not None else None, "cum": _r(r["cumul"])} for r in ds],
        "cops": [{"d": r["date"].strftime("%d/%m"), "cop": _r(r["cop"]), "aff": _r(r["entry"].get("cop_aff"))} for r in allc],
        "year_n1": year_n1_data,
    }

HTML = r"""<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#7B5B2E">
<title>Suivi PAC</title><style>
body{margin:0;font-family:system-ui,Segoe UI,Roboto,sans-serif;background:#f4f1ea;color:#1b2a41}
header{background:#7B5B2E;color:#fff;padding:14px 16px;position:sticky;top:0;z-index:10;box-shadow:0 2px 4px rgba(0,0,0,.15)}header h1{margin:0;font-size:20px}header small{opacity:.85}
.k{background:#7B5B2E;color:#fff;border-radius:10px;padding:12px;margin:10px}.k h3{margin:0 0 6px;font-size:13px;font-weight:600;opacity:.9}
.k .big{font-size:28px;font-weight:700}.k .row{display:flex;justify-content:space-between;margin-top:8px;font-size:13px}.k .row b{display:block;font-size:16px}
.bar{height:8px;background:rgba(255,255,255,.25);border-radius:4px;margin-top:10px;overflow:hidden}.bar i{display:block;height:100%;background:#d6f5c8}
.k small{display:block;margin-top:4px;opacity:.85}
.card{background:#fff;border-radius:10px;margin:10px;padding:12px;box-shadow:0 1px 3px rgba(0,0,0,.12)}
.card h2{font-size:15px;margin:0 0 8px;color:#1b2a41}canvas{width:100%;height:220px;display:block}
.v{font-size:16px;font-weight:700}.ok{color:#2e7d32}.no{color:#c62828}.mid{color:#b26a00}
table{width:100%;border-collapse:collapse;font-size:13px}td,th{padding:6px 4px;text-align:right;border-bottom:1px solid #eee}th:first-child,td:first-child{text-align:left}
</style></head><body>
<header><h1>Suivi PAC</h1><small id="maj"></small></header>
<div id="login" style="display:none;padding:16px"><div class="card"><h2>Accès protégé</h2>
<p>Entrez le mot de passe pour afficher le suivi.</p>
<input id="pw" type="password" autocomplete="current-password" style="width:100%;font-size:18px;padding:10px;box-sizing:border-box">
<label style="display:block;margin:10px 0"><input id="rem" type="checkbox" checked> Rester connecté sur cet appareil</label>
<button id="go" style="width:100%;font-size:18px;padding:12px;background:#7B5B2E;color:#fff;border:0;border-radius:8px">Ouvrir</button>
<p id="err" class="no"></p></div></div>
<div id="app">
<div id="cards"></div>
<div class="card" id="last"></div>
<div class="card" id="c_day_wrap"><h2>Aujourd'hui (EDF) vs références gaz + élec (€)</h2><canvas id="c_day"></canvas></div>
<div class="card"><h2>1. Dépense de chauffage cumulée sur l'année (€)</h2><canvas id="c1"></canvas></div>
<div class="card"><h2>2. Économie cumulée vs N-1 (€) et objectif</h2><canvas id="c2"></canvas></div>
<div class="card"><h2>3. Économie par mois vs N-1 (€) : mêmes jours</h2><canvas id="c_m_eco"></canvas></div>
<div class="card" id="c_year_wrap"><h2>4. Année de chauffage : N-1 gaz, élec et PAC (€)</h2><canvas id="c_year"></canvas></div>
<div class="card"><h2>5. Dépense du jour (EDF) vs N-1 et objectif (€)</h2><canvas id="c3"></canvas></div>
<div class="card"><h2>6. COP réel (barres) et COP affiché (points)</h2><canvas id="c4"></canvas></div>
<div class="card"><h2>Détail mensuel</h2><table id="tab"></table></div>
</div>
<script>
function render(D){
const f=(x,n=0)=>x==null?'–':x.toLocaleString('fr-FR',{minimumFractionDigits:n,maximumFractionDigits:n});
const sg=(x,n=0)=>x==null?'–':(x>0?'+':'')+f(x,n);
document.getElementById('maj').textContent='Année '+D.kpi.hy+' · Màj '+D.maj;
const K=D.kpi,L=D.last;
const pc=Math.max(0,Math.min(100,(K.eco[0]||0)/K.obj_eur*100));
document.getElementById('cards').innerHTML=
`<div class="k"><h3>Économie cumulée vs N-1</h3><div class="big">${sg(K.eco[0])} €</div>
<div class="row"><span>Ce mois<b>${sg(K.eco[1])} €</b></span><span>Dernier jour<b>${sg(K.eco[2],2)} €</b></span><span>Objectif<b>${f(K.obj_eur)} €</b></span></div>
<div class="bar"><i style="width:${pc}%"></i></div><small>${f(pc)} % de l'objectif annuel (${f(K.obj_eur)} €)</small></div>
<div class="k"><h3>Bénéfice vs N-1</h3><div class="big">${K.benef[0]==null?'–':sg(K.benef[0]*100)} %</div>
<div class="row"><span>Ce mois<b>${K.benef[1]==null?'–':sg(K.benef[1]*100)} %</b></span><span>Dernier jour<b>${K.benef[2]==null?'–':sg(K.benef[2]*100)} %</b></span><span>Objectif<b>${f(K.obj_pct*100)} %</b></span></div></div>`;
if(L){const cl=L.verdict.startsWith('Moins')?'ok':L.verdict.startsWith('Plus')?'no':'mid';
document.getElementById('last').innerHTML=`<h2>Dernier jour saisi : ${L.date}</h2><div class="v ${cl}">${L.verdict||'–'}</div>
<p style="margin:8px 0 0;line-height:1.45">Dépense EDF : <b>${f(L.dep,2)} €</b> (N-1 gaz+élec : ${f(L.ref_n1,2)} €, moy. : ${f(L.ref_mean,2)} €)<br>
COP réel : <b>${f(L.cop,2)}</b> · Élec hors PAC : <b>${f(L.hors_pac,1)} kWh</b><br>Température : <b>${f(L.temp,1)} °C</b> (habituel ${f(L.temp_ref,1)} °C)</p>`;}
function setup(id){const c=document.getElementById(id),r=window.devicePixelRatio||1,w=c.clientWidth,h=c.clientHeight;
c.width=w*r;c.height=h*r;const g=c.getContext('2d');g.scale(r,r);g.font='11px sans-serif';return [g,w,h];}
function frame(g,w,h,min,max,labels){const m={l:38,r:8,t:18,b:30};const pw=w-m.l-m.r,ph=h-m.t-m.b;
g.strokeStyle='#ddd';g.fillStyle='#666';g.textAlign='right';
for(let i=0;i<=4;i++){const v=min+(max-min)*i/4,y=m.t+ph-ph*i/4;g.beginPath();g.moveTo(m.l,y);g.lineTo(w-m.r,y);g.stroke();g.fillText(f(v,max-min<10?1:0),m.l-4,y+4);}
g.textAlign='center';const step=Math.max(1,Math.ceil(labels.length/7));labels.forEach((t,i)=>{if(i%step==0||i===labels.length-1)g.fillText(t,m.l+pw*(i+.5)/labels.length,h-10);});
return {m,pw,ph,y:v=>m.t+ph-ph*(v-min)/((max-min)||1)};}
function legend(g,items){let x=40;items.forEach(([n,c])=>{g.fillStyle=c;g.fillRect(x,3,10,10);g.fillStyle='#333';g.textAlign='left';g.fillText(n,x+13,12);x+=g.measureText(n).width+24;});}
function bars(id,labels,series,extra){const [g,w,h]=setup(id);let vals=series.flatMap(s=>s.v).concat(extra||[]).filter(v=>v!=null);
const max=Math.max(1,...vals)*1.1,min=Math.min(0,...vals);const F=frame(g,w,h,min,max,labels);const n=series.length,bw=F.pw/labels.length*.8/n;
series.forEach((s,j)=>{g.fillStyle=s.c;s.v.forEach((v,i)=>{if(v==null)return;const x=F.m.l+F.pw*i/labels.length+F.pw/labels.length*.1+j*bw;g.fillRect(x,Math.min(F.y(v),F.y(0)),bw,Math.abs(F.y(v)-F.y(0)));});});
legend(g,series.map(s=>[s.n,s.c]));return [g,F,labels];}
function line(g,F,labels,v,c,dash){g.strokeStyle=c;g.lineWidth=2;g.setLineDash(dash||[]);g.beginPath();let st=false;
v.forEach((y,i)=>{if(y==null)return;const x=F.m.l+F.pw*(i+.5)/labels.length;if(!st){g.moveTo(x,F.y(y));st=true}else g.lineTo(x,F.y(y));});g.stroke();g.setLineDash([]);}

/* 0. Jour vs références */
if(L&&L.dep!=null&&L.refs){
  const lab=['N-1','N-2','N-3','Moyenne'];
  const refVals=[L.refs[0],L.refs[1],L.refs[2],L.ref_mean];
  const [g,F]=bars('c_day',lab,[{n:'Aujourd\'hui (EDF)',c:'#7B5B2E',v:[L.dep,L.dep,L.dep,L.dep]},{n:'Référence (gaz+élec)',c:'#4FA3B8',v:refVals}]);
}else{document.getElementById('c_day_wrap').style.display='none';}

/* 1. Trajectoire cumulée */
{const [g,w,h]=setup('c1');const lab=D.traj.map(t=>t.d);const all=D.traj.flatMap(t=>[t.n1,t.reel]).filter(v=>v!=null);
const F=frame(g,w,h,0,Math.max(1,...all)*1.05,lab);
line(g,F,lab,D.traj.map(t=>t.n1),'#4FA3B8');line(g,F,lab,D.traj.map(t=>t.obj),'#2e7d32',[5,4]);line(g,F,lab,D.traj.map(t=>t.reel),'#7B5B2E');
legend(g,[['N-1','#4FA3B8'],['Obj. -'+f(K.obj_pct*100)+'%','#2e7d32'],['Cette année','#7B5B2E']]);}

/* 2. Économie cumulée */
{const [g,w,h]=setup('c2');const lab=D.jours.map(j=>j.d),v=D.jours.map(j=>j.cum),vv=v.filter(x=>x!=null).concat([K.obj_eur]);
const F=frame(g,w,h,Math.min(0,...vv),Math.max(1,...vv)*1.1,lab);line(g,F,lab,v,'#2e7d32');line(g,F,lab,lab.map(()=>K.obj_eur),'#b26a00',[5,4]);
legend(g,[['Économie','#2e7d32'],['Objectif '+f(K.obj_eur)+' €','#b26a00']]);}

/* 3. Économie par mois */
{const valid=D.mois.filter(m=>m.eco!=null);
const lab=valid.map(m=>m.l);
const v=valid.map(m=>m.eco);
const [g,w,h]=setup('c_m_eco');
const max=Math.max(1,...v)*1.15,min=Math.min(0,...v)*1.15;
const F=frame(g,w,h,min,max,lab);
const bw=F.pw/lab.length*.65;
valid.forEach((m,i)=>{
  g.fillStyle=m.eco>=0?'#2e7d32':'#c62828';
  const x=F.m.l+F.pw*i/lab.length+F.pw/lab.length*.17;
  g.fillRect(x,Math.min(F.y(m.eco),F.y(0)),bw,Math.abs(F.y(m.eco)-F.y(0)));
  g.fillStyle='#333';g.textAlign='center';
  g.fillText(sg(m.eco)+' €',x+bw/2,F.y(m.eco)+(m.eco>=0?-4:12));
});
legend(g,[['Gain mensuel','#2e7d32'],['Surcoût','#c62828']]);}

/* 4. Année de chauffage complète */
if(D.year_n1){
  const yn=D.year_n1;const lab=yn.labels;
  const [g,F]=bars('c_year',lab,[{n:'Gaz N-1',c:'#E0883A',v:yn.gaz},{n:'Élec N-1',c:'#4FA3B8',v:yn.elec}]);
  line(g,F,lab,yn.total_n1,'#1B2A41');
  line(g,F,lab,yn.pac,'#7B5B2E');
  // Points PAC
  g.fillStyle='#7B5B2E';
  yn.pac.forEach((v,i)=>{if(v==null)return;const x=F.m.l+F.pw*(i+.5)/lab.length;g.beginPath();g.arc(x,F.y(v),3.5,0,7);g.fill();});
}else{document.getElementById('c_year_wrap').style.display='none';}

/* 5. Dépense du jour vs N-1 */
{const lab=D.jours.map(j=>j.d);const [g,F]=bars('c3',lab,[{n:'EDF du jour',c:'#7B5B2E',v:D.jours.map(j=>j.dep)}],D.jours.map(j=>j.n1));
line(g,F,lab,D.jours.map(j=>j.n1),'#4FA3B8');line(g,F,lab,D.jours.map(j=>j.obj),'#2e7d32',[5,4]);}

/* 6. COP */
{const lab=D.cops.map(c=>c.d);const [g,F]=bars('c4',lab,[{n:'COP réel',c:'#4FA3B8',v:D.cops.map(c=>c.cop)}]);
g.fillStyle='#c62828';D.cops.forEach((c,i)=>{if(c.aff==null)return;g.beginPath();g.arc(F.m.l+F.pw*(i+.5)/lab.length,F.y(c.aff),3,0,7);g.fill();});
line(g,F,lab,lab.map(()=>K.cop_rentab),'#b26a00',[5,4]);}

/* Tableau */
document.getElementById('tab').innerHTML='<tr><th>Mois</th><th>Jours</th><th>Réel €</th><th>N-1</th><th>Économie</th><th>COP</th></tr>'+
D.mois.map(m=>`<tr><td>${m.l}</td><td>${m.j}</td><td>${f(m.t)}</td><td>${f(m.n1)}</td><td>${sg(m.eco)}</td><td>${f(m.cop,2)}</td></tr>`).join('');
}
__BOOT__
</script></body></html>"""

BOOT_CLEAR = "render(__DATA__);"
BOOT_ENC = r"""
const ENV=__ENV__;
const b64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function decryptWith(pw){
  const enc=new TextEncoder();
  const km=await crypto.subtle.importKey('raw',enc.encode(pw),'PBKDF2',false,['deriveKey']);
  const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt:b64(ENV.salt),iterations:ENV.iter,hash:'SHA-256'},km,{name:'AES-GCM',length:256},false,['decrypt']);
  const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:b64(ENV.iv)},key,b64(ENV.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
async function tryUnlock(pw,remember){
  try{
    const D=await decryptWith(pw);
    if(remember){try{localStorage.setItem('spw',pw)}catch(e){}}
    document.getElementById('login').style.display='none';
    document.getElementById('app').style.display='block';
    render(D);return true;
  }catch(e){return false;}
}
document.getElementById('app').style.display='none';
(async()=>{
  let p=null;try{p=localStorage.getItem('spw')}catch(e){}
  if(p&&await tryUnlock(p,false))return;
  document.getElementById('login').style.display='block';
  if(!(window.crypto&&window.crypto.subtle)){document.getElementById('err').textContent="Ouvrez cette page en https:// (le déchiffrement n'est pas possible en http).";return;}
  const go=async()=>{
    const ok=await tryUnlock(document.getElementById('pw').value,document.getElementById('rem').checked);
    if(!ok)document.getElementById('err').textContent='Mot de passe incorrect.';
  };
  document.getElementById('go').onclick=go;
  document.getElementById('pw').addEventListener('keydown',e=>{if(e.key==='Enter')go()});
})();
"""
KDF_ITER = 200000

def encrypt_payload(payload, password):
    """Chiffre le JSON : PBKDF2-SHA256 (200 000 tours) + AES-256-GCM. Format lisible par WebCrypto (navigateur)."""
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    except ImportError:
        raise RuntimeError("Le module « cryptography » est absent : installez-le (Thonny > Outils > Gérer les paquets).")
    import hashlib
    salt, iv = os.urandom(16), os.urandom(12)
    key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, KDF_ITER, 32)
    ct = AESGCM(key).encrypt(iv, json.dumps(payload, ensure_ascii=False).encode("utf-8"), None)   # ct = chiffré + étiquette GCM
    b = lambda x: base64.b64encode(x).decode("ascii")
    return {"v": 1, "kdf": "PBKDF2-SHA256", "iter": KDF_ITER, "cipher": "AES-256-GCM", "salt": b(salt), "iv": b(iv), "ct": b(ct)}

def export_mobile(model, folder=None):
    """Version NON chiffrée (Wi-Fi local, dossier partagé) : index.html autonome + data.json."""
    folder = Path(folder) if folder else MOBILE_DIR
    folder.mkdir(parents=True, exist_ok=True)
    payload = mobile_payload(model)
    out = folder / "index.html"
    out.write_text(HTML.replace("__BOOT__", BOOT_CLEAR).replace("__DATA__", json.dumps(payload, ensure_ascii=False)), encoding="utf-8")
    (folder / "data.json").write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    return out

def export_online(model, password, folder=None):
    """Version CHIFFRÉE pour l'hébergement public : index.html (écran de mot de passe) + data.json chiffré."""
    folder = Path(folder) if folder else MOBILE_DIR / "en_ligne"
    folder.mkdir(parents=True, exist_ok=True)
    env = encrypt_payload(mobile_payload(model), password)
    out = folder / "index.html"
    out.write_text(HTML.replace("__BOOT__", BOOT_ENC).replace("__ENV__", json.dumps(env)), encoding="utf-8")
    (folder / "data.json").write_text(json.dumps(env, indent=1), encoding="utf-8")
    return out

# ----------------------------------------------------------------------------
# Publication en ligne (GitHub Pages) : aucun module supplémentaire, uniquement l'API GitHub
# ----------------------------------------------------------------------------
def _gh_error(e):
    try:
        msg = json.loads(e.read().decode("utf-8")).get("message", "")
    except Exception:
        msg = ""
    if e.code == 401:
        return "GitHub refuse le jeton (401) : jeton faux, expiré ou mal recopié."
    if e.code in (403, 404):
        return (f"Accès refusé ou dépôt introuvable ({e.code}). Vérifiez l'identifiant, le nom du dépôt, "
                "et que le jeton a le droit « Contents : Read and write » sur CE dépôt. " + msg)
    return f"Erreur GitHub {e.code} : {msg}"

def publish_github(user, repo, token, files, branch="main"):
    """files : {chemin_dans_le_depot: octets}. Envoie (ou remplace) chaque fichier. Retourne l'adresse de la page."""
    api = f"https://api.github.com/repos/{user}/{repo}/contents/"
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
               "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "SuiviPAC"}
    for path, data in files.items():
        sha = None
        try:
            req = urllib.request.Request(api + path + f"?ref={branch}", headers=headers)
            with urllib.request.urlopen(req, timeout=30) as r:
                sha = json.load(r).get("sha")
        except urllib.error.HTTPError as e:
            if e.code != 404:
                raise RuntimeError(_gh_error(e))
        except urllib.error.URLError as e:
            raise RuntimeError(f"Pas de connexion internet : {e.reason}")
        neutre = {"name": "Suivi PAC", "email": "suivi-pac@users.noreply.github.com"}   # aucune adresse mail réelle dans l'historique
        body = {"message": "Mise à jour Suivi PAC " + dt.datetime.now().strftime("%d/%m/%Y %H:%M"),
                "content": base64.b64encode(data).decode("ascii"), "branch": branch,
                "author": neutre, "committer": neutre}
        if sha:
            body["sha"] = sha
        req = urllib.request.Request(api + path, data=json.dumps(body).encode("utf-8"), method="PUT",
                                     headers={**headers, "Content-Type": "application/json"})
        try:
            urllib.request.urlopen(req, timeout=60).close()
        except urllib.error.HTTPError as e:
            raise RuntimeError(_gh_error(e))
        except urllib.error.URLError as e:
            raise RuntimeError(f"Pas de connexion internet : {e.reason}")
    return f"https://{user}.github.io/{repo}/"

def publish_online(model, cfg):
    """Génère la page (chiffrée si un mot de passe est configuré) puis l'envoie sur GitHub Pages."""
    need = [k for k in ("github_user", "github_repo", "github_token") if not cfg.get(k)]
    if need:
        raise ValueError("Publication non configurée (menu Téléphone > Configurer la publication en ligne).")
    pw = cfg.get("github_password")
    out = export_online(model, pw) if pw else export_mobile(model, MOBILE_DIR / "en_ligne")
    files = {"index.html": out.read_bytes(), "data.json": (out.parent / "data.json").read_bytes()}
    return publish_github(cfg["github_user"], cfg["github_repo"], cfg["github_token"], files, cfg.get("github_branch", "main"))

def local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1)); return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()

_server = {"srv": None}
def start_wifi_server(folder=None, port=8765):
    """Sert le dossier mobile sur le réseau local. Retourne l'adresse à ouvrir sur le téléphone."""
    stop_wifi_server()
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(folder or MOBILE_DIR))
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.TCPServer(("", port), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    _server["srv"] = srv
    return f"http://{local_ip()}:{port}/"

def stop_wifi_server():
    if _server["srv"]:
        _server["srv"].shutdown(); _server["srv"].server_close(); _server["srv"] = None

# ----------------------------------------------------------------------------
# Graphiques (matplotlib) : utilisés par l'interface, testables sans fenêtre
# ----------------------------------------------------------------------------
BROWN, NAVY, TEAL, GREEN, RED, ORANGE, GAZ = "#7B5B2E", "#1B2A41", "#4FA3B8", "#2E7D32", "#C62828", "#B26A00", "#E0883A"

def _style(axs):
    import matplotlib.dates as mdates
    for a in axs:
        a.grid(axis="y", alpha=.25); a.spines[["top", "right"]].set_visible(False); a.tick_params(labelsize=7)
        a.title.set_fontsize(10)

def _datefmt(ax):
    import matplotlib.dates as mdates
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%d/%m")); ax.xaxis.set_major_locator(mdates.AutoDateLocator(maxticks=6))

def draw_gauge(ax, value, target, title, unit="€"):
    """Demi-anneau « objectif » (comme le graphique Target économies de l'Excel)."""
    ax.clear(); ax.set_title(title, fontsize=10, loc="center")
    frac = 0 if not target or value is None else max(0.0, min(1.0, value / target))
    ax.pie([frac, 1 - frac, 1], colors=[GREEN, "#E6E6E6", "none"], startangle=180, counterclock=False,
           wedgeprops=dict(width=0.32, edgecolor="white"))
    ax.set_ylim(-0.25, 1.05); ax.set_xlim(-1.1, 1.1); ax.set_aspect("equal")
    txt = "–" if value is None else f"{value:,.0f} {unit}".replace(",", " ")
    ax.text(0, 0.18, txt, ha="center", va="center", fontsize=15, fontweight="bold", color=GREEN if frac >= 1 else NAVY)
    ax.text(0, -0.08, f"objectif {target:,.0f} {unit}  ({frac * 100:.0f} %)".replace(",", " "), ha="center", va="center", fontsize=8, color="#555")

def draw_dashboard(fig, model):
    """Page Suivi : 6 graphiques."""
    import numpy as np
    fig.clear()
    axs = fig.subplots(3, 2).flatten()
    mo, k = model["months"], model["kpi"]
    hy = model["hy_days"]
    # 1. Trajectoire de l'année : dépense cumulée cette année vs N-1 et objectif
    ax = axs[0]; ax.set_title("Dépense de chauffage cumulée sur l'année (€)", loc="left")
    tj = model.get("traj") or []
    if tj:
        xs = [t["date"] for t in tj]
        ax.plot(xs, [t["n1"] for t in tj], color=TEAL, lw=2, label="N-1 (gaz + élec)")
        ax.plot(xs, [t["obj"] for t in tj], color=GREEN, lw=1.5, ls="--", label=f"Objectif -{k['obj_pct'] * 100:.0f} %")
        rr = [t for t in tj if t["reel"] is not None]
        if rr:
            ax.plot([t["date"] for t in rr], [t["reel"] for t in rr], color=BROWN, lw=2.8, label="Cette année (élec)")
            t = rr[-1]
            ax.plot([t["date"]], [t["reel"]], "o", color=BROWN)
            ax.annotate(f"{t['reel']:.0f} €", (t["date"], t["reel"]), textcoords="offset points", xytext=(6, -12), fontsize=9, fontweight="bold", color=BROWN)
            ax.annotate(f"N-1 : {t['n1']:.0f} €", (t["date"], t["n1"]), textcoords="offset points", xytext=(-8, 6), ha="right", fontsize=8, color=TEAL)
        ax.legend(fontsize=7, frameon=False, loc="upper left"); _datefmt(ax)
    # 2. Économie cumulée + objectif
    ax = axs[1]; ax.set_title("Économie cumulée vs N-1 (€)", loc="left")
    dd = [r for r in hy if r["cumul"] is not None]
    if dd:
        xs = [r["date"] for r in dd]; ys = [r["cumul"] for r in dd]
        ax.plot(xs, ys, color=GREEN, lw=2); ax.fill_between(xs, ys, color=GREEN, alpha=.15)
        ax.annotate(f"{ys[-1]:.0f} €", (xs[-1], ys[-1]), textcoords="offset points", xytext=(-6, 6), ha="right", fontsize=9, fontweight="bold", color=GREEN)
    ax.axhline(k["obj_eur"], color=ORANGE, ls="--", lw=1.5, label=f"Objectif {k['obj_eur']:.0f} €")
    ax.set_ylim(min(0, min([r["cumul"] for r in dd], default=0)), max(k["obj_eur"] * 1.08, max([r["cumul"] for r in dd], default=0) * 1.1))
    ax.legend(fontsize=7, frameon=False, loc="upper left"); _datefmt(ax)
    # 3. Économie mensuelle vs N-1
    ax = axs[2]; ax.set_title("Économie par mois vs N-1 (€) : mêmes jours", loc="left")
    em = [m for m in mo if m["eco"] is not None]
    if em:
        v = [m["eco"] for m in em]
        b = ax.bar([m["label"] + (f"\n{m['jours']}/{m['jours_mois']} jours" if m["partiel"] else "") for m in em], v, color=[GREEN if a >= 0 else RED for a in v])
        for rect, a in zip(b, v):
            ax.text(rect.get_x() + rect.get_width() / 2, a, f"{a:+.0f}", ha="center", va="bottom" if a >= 0 else "top", fontsize=8)
        ax.axhline(0, color="#999", lw=.8)
    # 4. Année de chauffage : factures de l'an dernier (gaz + élec) et élec PAC
    ax = axs[3]; ax.set_title("Année de chauffage : N-1 gaz, N-1 élec, total N-1 et élec PAC (€)", loc="left")
    yn = model.get("year_n1")
    if yn:
        lab = yn["labels"]; x = np.arange(12)
        g_ = [a or 0 for a in yn["gaz"]]; e_ = [a or 0 for a in yn["elec"]]
        ax.bar(x - 0.2, g_, 0.38, color=GAZ, label="Gaz N-1"); ax.bar(x + 0.2, e_, 0.38, color=TEAL, label="Élec N-1")
        ax.plot(x, [a + b for a, b in zip(g_, e_)], color=NAVY, marker="o", ms=3, lw=1.2, label="Total N-1")
        hy0 = k["hy0"]
        monthly = {m["m"]: m["reel"] for m in mo if not (m["y"] == hy0.year and m["m"] == 9)}   # sept. de départ : hors tableau oct→sept
        order = [10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9]
        px = [i for i, mn in enumerate(order) if monthly.get(mn)]          # les mois à 0 ou vides ne sont pas tracés
        py = [monthly[order[i]] for i in px]
        if px:
            ax.plot(px, py, color=BROWN, marker="o", lw=2.5, label="Élec PAC (réel)")
            for a, b in zip(px, py): ax.annotate(f"{b:.0f}", (a, b), textcoords="offset points", xytext=(0, 6), ha="center", fontsize=8, color=BROWN, fontweight="bold")
        ax.set_xticks(x); ax.set_xticklabels(lab, fontsize=8); ax.legend(fontsize=7, frameon=False, ncol=2)
    else:
        ax.text(.5, .5, "Tableau mensuel de la feuille « Ref N-1 » introuvable", ha="center", transform=ax.transAxes, fontsize=8)
    # 5. Dépense du jour vs N-1 et objectif
    ax = axs[4]; ax.set_title("Dépense du jour (EDF) vs N-1 et objectif (€)", loc="left")
    dk = [r for r in hy if r["depense"] is not None][-60:]
    if dk:
        x = [r["date"] for r in dk]
        ax.bar(x, [r["depense"] for r in dk], color=BROWN, label="EDF du jour")
        xr = [r["date"] for r in dk if r["ref_n1"] is not None]
        ax.plot(xr, [r["ref_n1"] for r in dk if r["ref_n1"] is not None], color=TEAL, lw=1.8, label="N-1 (gaz+élec)")
        ax.plot(xr, [r["ref_n1"] * (1 - k["obj_pct"]) for r in dk if r["ref_n1"] is not None], color=GREEN, ls="--", lw=1.5, label=f"Objectif -{k['obj_pct'] * 100:.0f} %")
        ax.legend(fontsize=7, frameon=False, ncol=3); _datefmt(ax)
    # 6. COP réel
    ax = axs[5]; ax.set_title("COP réel du jour", loc="left")
    dc = [r for r in model["days"] if r["cop"] is not None]
    if dc:
        ax.bar([r["date"] for r in dc], [r["cop"] for r in dc], color=TEAL, label="COP réel")
        da = [r for r in dc if r["entry"].get("cop_aff") is not None]
        if da: ax.plot([r["date"] for r in da], [r["entry"]["cop_aff"] for r in da], "o", color=RED, ms=3, label="COP affiché")
        ax.axhline(k["cop_rentab"], color=ORANGE, ls="--", lw=1, label="Rentabilité gaz")
        ax.axhline(k["cop_cible"], color=GREEN, ls=":", lw=1, label="Cible")
        ax.legend(fontsize=7, frameon=False, ncol=2); _datefmt(ax)
    _style(axs)
    fig.tight_layout(h_pad=2.2)

def draw_day_charts(fig, r, model):
    """Sous les résultats de la page Saisie : graphique 1 (aujourd'hui vs références) + graphique 2 (objectif économies)."""
    fig.clear()
    ax1, ax2 = fig.subplots(1, 2, gridspec_kw={"width_ratios": [1.5, 1]})
    ax1.set_title("Aujourd'hui (EDF) vs références gaz + élec (€)", loc="left")
    if r is not None and r["depense"] is not None:
        import numpy as np
        refs = list(r["refs"]) + [r["ref_mean"]]
        labels = ["N-1", "N-2", "N-3", "Moyenne"]
        x = np.arange(4)
        ax1.bar(x - 0.2, [r["depense"]] * 4, 0.38, color=BROWN, label="Aujourd'hui (EDF)")
        b = ax1.bar(x + 0.2, [0 if v is None else v for v in refs], 0.38, color=TEAL, label="Référence (gaz+élec)")
        ax1.text(-0.2, r["depense"], f"{r['depense']:.2f}", ha="center", va="bottom", fontsize=8, fontweight="bold", color=BROWN)
        for rect, v in zip(b, refs):
            if v is not None: ax1.text(rect.get_x() + rect.get_width() / 2, v, f"{v:.2f}", ha="center", va="bottom", fontsize=8)
            else: ax1.text(rect.get_x() + rect.get_width() / 2, 0, "n/d", ha="center", va="bottom", fontsize=7, color="#888")
        ax1.set_xticks(x); ax1.set_xticklabels(labels, fontsize=8); ax1.legend(fontsize=7, frameon=False)
    else:
        ax1.text(.5, .5, "Saisissez l'EDF du jour", ha="center", transform=ax1.transAxes, color="#888")
    _style([ax1])
    k = model["kpi"]
    draw_gauge(ax2, k["eco_cumul"], k["obj_eur"], "Objectif économies de l'année (€)")
    fig.tight_layout()
