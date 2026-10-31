#!/usr/bin/env python3
"""
Clapp napló elemző: megkeresi, melyik gyári adatbájt mit jelent.

A Clapp OBD képernyőjének „Napló vezetés közben” funkciója CSV fájlt ment: körönként a
szabványos értékeket (fordulat, sebesség, hőfokok… oszlopnév vége pl. `[010C]`) és a gyári
válaszokat nyersen (oszlopnév pl. `6A8.21C1` vagy `6A8.22D400`).

Az elemzés minden nyers válaszból jelölt értékeket vág ki (1 bájt, 2 bájt nagy és kicsi
végű sorrendben, előjelesen és előjel nélkül), és mindegyiket összeveti a szabványos
értékekkel:

  * ha egy jelölt szorosan együtt mozog egy ismert értékkel (|r| >= 0,95), a lineáris
    illesztésből a képlet is kiderül (érték = a * nyers + b);
  * ami nem illik semmihez, azt alakja szerint soroljuk be: állandó (azonosító, beállítás),
    folyamatosan növő számláló (km, üzemóra; ha lenullázódik, az lehet regenerálás),
    kevés különböző értékű állapot (kapcsoló, üzemmód), vagy ismeretlen változó.

Használat:
    python3 scripts/analyze-log.py clapp-naplo-....csv [--out jelentes.md] [--min-r 0.95]

Csak a Python szabványos könyvtárát használja.
"""

import argparse
import csv
import math
import re
import sys
from dataclasses import dataclass

RAW_COLUMN = re.compile(r"^[0-9A-F]{3}\.2[12][0-9A-F]+$")
REF_COLUMN = re.compile(r"\[01([0-9A-F]{2})\]$")


@dataclass
class Candidate:
    column: str
    offset: int
    kind: str  # u8, s8, u16be, s16be, u16le, s16le
    values: list  # float vagy None soronként

    @property
    def label(self) -> str:
        return f"{self.column} bájt {self.offset}{'' if self.kind.endswith('8') else '-' + str(self.offset + 1)} ({self.kind})"


def read_log(path):
    with open(path, encoding="utf-8") as f:
        lines = [line for line in f if not line.startswith("#")]
    reader = csv.reader(lines, delimiter=";")
    header = next(reader)
    rows = [row + [""] * (len(header) - len(row)) for row in reader if row]
    columns = {name: [row[i] for row in rows] for i, name in enumerate(header)}
    return header, columns, len(rows)


def to_float(text):
    try:
        return float(text)
    except ValueError:
        return None


def hex_bytes(text):
    if not text or len(text) % 2:
        return None
    try:
        return bytes.fromhex(text)
    except ValueError:
        return None


def candidates_for(column, raw_values):
    parsed = [hex_bytes(v) for v in raw_values]
    longest = max((len(b) for b in parsed if b), default=0)
    out = []
    for offset in range(longest):
        def series(fn, width):
            vals = []
            for b in parsed:
                vals.append(fn(b[offset : offset + width]) if b and len(b) >= offset + width else None)
            return vals

        out.append(Candidate(column, offset, "u8", series(lambda x: x[0], 1)))
        out.append(Candidate(column, offset, "s8", series(lambda x: x[0] - 256 if x[0] > 127 else x[0], 1)))
        if offset + 1 < longest:
            out.append(Candidate(column, offset, "u16be", series(lambda x: int.from_bytes(x, "big"), 2)))
            out.append(Candidate(column, offset, "s16be", series(lambda x: int.from_bytes(x, "big", signed=True), 2)))
            out.append(Candidate(column, offset, "u16le", series(lambda x: int.from_bytes(x, "little"), 2)))
            out.append(Candidate(column, offset, "s16le", series(lambda x: int.from_bytes(x, "little", signed=True), 2)))
    return out


def has_constant_byte(cand):
    """Két bájtos jelölt, aminek az egyik bájtja állandó: ez valójában egy bájtos érték."""
    if cand.kind.endswith("8"):
        return False
    highs, lows = set(), set()
    for v in cand.values:
        if v is not None:
            highs.add((int(v) >> 8) & 0xFF)
            lows.add(int(v) & 0xFF)
    return len(highs) <= 1 or len(lows) <= 1


def paired(xs, ys):
    return [(x, y) for x, y in zip(xs, ys) if x is not None and y is not None]


def correlate(xs, ys):
    """Pearson r és lineáris illesztés y = a*x + b."""
    pairs = paired(xs, ys)
    n = len(pairs)
    if n < 10:
        return None
    mx = sum(p[0] for p in pairs) / n
    my = sum(p[1] for p in pairs) / n
    sxx = sum((p[0] - mx) ** 2 for p in pairs)
    syy = sum((p[1] - my) ** 2 for p in pairs)
    sxy = sum((p[0] - mx) * (p[1] - my) for p in pairs)
    if sxx == 0 or syy == 0:
        return None
    r = sxy / math.sqrt(sxx * syy)
    a = sxy / sxx
    b = my - a * mx
    return r, a, b, n


def distinct(values):
    return sorted({v for v in values if v is not None})


def classify(values):
    present = [v for v in values if v is not None]
    if len(present) < 3:
        return "kevés adat", ""
    uniq = distinct(present)
    if len(uniq) == 1:
        return "állandó", f"{uniq[0]:g}"
    ups = sum(1 for a, b in zip(present, present[1:]) if b > a)
    downs = sum(1 for a, b in zip(present, present[1:]) if b < a)
    drops = [(a, b) for a, b in zip(present, present[1:]) if b < a]
    big_drops = [d for d in drops if d[0] - d[1] > (max(uniq) - min(uniq)) * 0.5]
    if ups > 0 and downs <= len(big_drops) and len(uniq) > 3:
        note = f"{present[0]:g} → {present[-1]:g}"
        if big_drops:
            note += f", {len(big_drops)}× lenullázódott (pl. {big_drops[0][0]:g} → {big_drops[0][1]:g})"
        return "növő számláló", note
    if len(uniq) <= 6:
        return "állapot / kapcsoló", ", ".join(f"{v:g}" for v in uniq)
    return "változó, ismeretlen", f"{min(uniq):g} … {max(uniq):g}"


def nice(x):
    return f"{x:.6g}"


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("log")
    parser.add_argument("--out", help="A jelentés ide kerül (Markdown). Alapból a képernyőre.")
    parser.add_argument("--min-r", type=float, default=0.95, help="Ennél szorosabb együttmozgást fogadunk el.")
    args = parser.parse_args()

    header, columns, row_count = read_log(args.log)
    refs = {name: [to_float(v) for v in columns[name]] for name in header if REF_COLUMN.search(name)}
    # Az eltelt idő is referencia: a km- és időszámlálók ehhez igazodnak.
    if "ms" in columns:
        refs["eltelt idő (s)"] = [None if to_float(v) is None else to_float(v) / 1000 for v in columns["ms"]]
    raw_columns = [name for name in header if RAW_COLUMN.match(name)]
    known_columns = [name for name in header if " [" in name and not REF_COLUMN.search(name)]

    lines = [
        f"# Clapp napló elemzés",
        "",
        f"Fájl: `{args.log}`, {row_count} sor, {len(raw_columns)} nyers gyári válasz, {len(refs)} ismert érték.",
        "",
    ]
    if row_count < 30:
        lines += ["**Figyelem:** kevés sor, az eredmény bizonytalan. Legalább 10–15 perces út kell.", ""]

    matches = []
    unknown = []
    constants = {}
    for column in raw_columns:
        cands = candidates_for(column, columns[column])
        by_offset = {}
        for cand in cands:
            if len(distinct(cand.values)) <= 1 or has_constant_byte(cand):
                continue
            best = None
            for ref_name, ref_values in refs.items():
                res = correlate(cand.values, ref_values)
                if res and (best is None or abs(res[0]) > abs(best[1][0])):
                    best = (ref_name, res)
            if best and abs(best[1][0]) >= args.min_r:
                key = (column, cand.offset)
                if key not in by_offset or abs(best[1][0]) > abs(by_offset[key][1][1][0]):
                    by_offset[key] = (cand, best)
        matched_offsets = set()
        for (col, offset), (cand, (ref_name, (r, a, b, n))) in by_offset.items():
            matches.append((abs(r), cand, ref_name, r, a, b, n))
            matched_offsets.add(offset)
            if not cand.kind.endswith("8"):
                matched_offsets.add(offset + 1)
        # Két bájtos számlálók (km, idő): előbb ezeket keressük, hogy ne essenek szét.
        for cand in cands:
            if cand.kind != "u16be" or {cand.offset, cand.offset + 1} & matched_offsets:
                continue
            if has_constant_byte(cand):
                continue
            kind, note = classify(cand.values)
            if kind == "növő számláló":
                unknown.append((column, f"{cand.offset}-{cand.offset + 1} (u16be)", kind, note))
                matched_offsets |= {cand.offset, cand.offset + 1}
        for cand in cands:
            if cand.kind != "u8" or cand.offset in matched_offsets:
                continue
            kind, note = classify(cand.values)
            if kind == "állandó":
                constants.setdefault(column, []).append(f"{cand.offset}={int(float(note)):02X}")
            else:
                unknown.append((column, cand.offset, kind, note))

    matches.sort(key=lambda m: -m[0])
    lines += ["## Ismert értékkel együtt mozgó bájtok", ""]
    if not matches:
        lines += ["Nincs találat. Hosszabb, változatosabb út kell (gázadás, hőfokváltozás).", ""]
    else:
        lines += [
            "| Nyers adat | Ezzel mozog együtt | r | Képlet (érték = a × nyers + b) | Sorok |",
            "| --- | --- | --- | --- | --- |",
        ]
        for _, cand, ref_name, r, a, b, n in matches:
            lines.append(f"| {cand.label} | {ref_name} | {r:.3f} | a = {nice(a)}, b = {nice(b)} | {n} |")
        lines += [""]

    lines += ["## Egyéb változó bájtok (alak szerint)", ""]
    groups = {}
    for column, offset, kind, note in unknown:
        groups.setdefault(kind, []).append(f"- `{column}` bájt {offset}: {note}")
    order = ["növő számláló", "állapot / kapcsoló", "változó, ismeretlen", "kevés adat"]
    for kind in order:
        if kind in groups:
            lines += [f"### {kind.capitalize()} ({len(groups[kind])})", "", *groups[kind], ""]
    if "növő számláló" in groups:
        lines += [
            "Tipp: a lenullázódó számlálók közül valamelyik a „km az utolsó regenerálás óta”, a lassan "
            "növő és regeneráláskor leeső érték pedig a koromtöltöttség lehet.",
            "",
        ]

    if constants:
        lines += ["## Állandó bájtok (azonosítók, beállítások)", ""]
        for column, items in constants.items():
            lines.append(f"- `{column}`: {' '.join(items)}")
        lines += [""]

    if known_columns:
        lines += ["## OBDb szerint ismert jelek (ellenőrzés)", ""]
        for name in known_columns:
            vals = [to_float(v) for v in columns[name]]
            present = [v for v in vals if v is not None]
            if not present:
                continue
            lines.append(f"- {name}: {min(present):g} … {max(present):g}")
        lines += [""]

    text = "\n".join(lines)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(text)
        print(f"Jelentés: {args.out}")
    else:
        sys.stdout.write(text)


if __name__ == "__main__":
    main()
