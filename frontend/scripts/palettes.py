"""Editor palettes -> arrdeck tokens, nudged only where a colour misses contrast.

The published colours of each palette are mapped onto arrdeck's roles
(background, card, raised surface, line, text, muted text, accent, status).
A colour that misses the bar is moved toward black or white in 1% steps until
it clears it: text holds AA everywhere, badge colours AA in light variants and
3:1 in dark ones — the bars arrdeck's own themes meet. Most dark palettes come
through untouched; the report lists every colour that moved.

    python3 scripts/palettes.py OUTDIR

writes OUTDIR/palettes.css (the blocks in src/index.css) and OUTDIR/palettes.json
(the source of the swatches in src/lib/palettes.ts and of the iOS app's
Palettes.swift). Regenerate all three together.
"""
import json, sys

def hx(h): h=h.lstrip('#'); return tuple(int(h[i:i+2],16) for i in (0,2,4))
def tohex(c): return '#%02x%02x%02x' % tuple(max(0,min(255,round(v))) for v in c)
def ch(v):
    c=v/255; return c/12.92 if c<=0.04045 else ((c+0.055)/1.055)**2.4
def lum(h): r,g,b=hx(h); return 0.2126*ch(r)+0.7152*ch(g)+0.0722*ch(b)
def contrast(a,b):
    x,y=sorted([lum(a),lum(b)],reverse=True); return (x+0.05)/(y+0.05)
def mix(a,b,t):
    A,B=hx(a),hx(b); return tohex(tuple(A[i]+(B[i]-A[i])*t for i in range(3)))

def nudge(color, against, target, toward):
    """Move `color` toward `toward` in small steps until it clears `target`
    against every colour in `against`. Returns the colour and how far it moved."""
    for i in range(0, 101):
        c = mix(color, toward, i/100)
        if all(contrast(c, bg) >= target for bg in against):
            return c, i
    raise SystemExit(f"cannot fix {color}")

# name, variant, mode, then the palette's own colours mapped onto roles
P = {
 ("catppuccin","dark"): dict(bg="#181825",card="#1e1e2e",raised="#313244",line="#45475a",fg="#cdd6f4",muted="#a6adc8",
     primary="#cba6f7",danger="#f38ba8",ok="#a6e3a1",warn="#f9e2af",ink="#11111b"),
 ("catppuccin","light"): dict(bg="#e6e9ef",card="#eff1f5",raised="#dce0e8",line="#ccd0da",fg="#4c4f69",muted="#6c6f85",
     primary="#8839ef",danger="#d20f39",ok="#40a02b",warn="#df8e1d",ink="#ffffff"),
 ("dracula","dark"): dict(bg="#21222c",card="#282a36",raised="#44475a",line="#44475a",fg="#f8f8f2",muted="#6272a4",
     primary="#bd93f9",danger="#ff5555",ok="#50fa7b",warn="#f1fa8c",ink="#21222c"),
 ("nord","dark"): dict(bg="#2e3440",card="#3b4252",raised="#434c5e",line="#4c566a",fg="#eceff4",muted="#d8dee9",
     primary="#88c0d0",danger="#bf616a",ok="#a3be8c",warn="#ebcb8b",ink="#2e3440"),
 ("nord","light"): dict(bg="#e5e9f0",card="#eceff4",raised="#d8dee9",line="#d8dee9",fg="#2e3440",muted="#4c566a",
     primary="#5e81ac",danger="#bf616a",ok="#a3be8c",warn="#d08770",ink="#ffffff"),
 ("gruvbox","dark"): dict(bg="#1d2021",card="#282828",raised="#3c3836",line="#504945",fg="#ebdbb2",muted="#a89984",
     primary="#83a598",danger="#fb4934",ok="#b8bb26",warn="#fabd2f",ink="#1d2021"),
 ("gruvbox","light"): dict(bg="#f2e5bc",card="#fbf1c7",raised="#ebdbb2",line="#d5c4a1",fg="#3c3836",muted="#7c6f64",
     primary="#076678",danger="#9d0006",ok="#79740e",warn="#b57614",ink="#fbf1c7"),
 ("solarized","dark"): dict(bg="#002b36",card="#073642",raised="#0e4553",line="#1f5664",fg="#93a1a1",muted="#839496",
     primary="#268bd2",danger="#dc322f",ok="#859900",warn="#b58900",ink="#002b36"),
 ("solarized","light"): dict(bg="#eee8d5",card="#fdf6e3",raised="#e6dfca",line="#d9d2bd",fg="#073642",muted="#586e75",
     primary="#268bd2",danger="#dc322f",ok="#859900",warn="#b58900",ink="#fdf6e3"),
 ("tokyonight","dark"): dict(bg="#16161e",card="#1a1b26",raised="#292e42",line="#3b4261",fg="#c0caf5",muted="#737aa2",
     primary="#7aa2f7",danger="#f7768e",ok="#9ece6a",warn="#e0af68",ink="#16161e"),
 ("tokyonight","light"): dict(bg="#d0d5e3",card="#e1e2e7",raised="#c4c8da",line="#b6bfe2",fg="#3760bf",muted="#6172b0",
     primary="#2e7de9",danger="#f52a65",ok="#587539",warn="#8c6c3e",ink="#ffffff"),
 ("onedark","dark"): dict(bg="#21252b",card="#282c34",raised="#3b4048",line="#3e4451",fg="#abb2bf",muted="#7f848e",
     primary="#61afef",danger="#e06c75",ok="#98c379",warn="#e5c07b",ink="#21252b"),
 ("onedark","light"): dict(bg="#eaeaeb",card="#fafafa",raised="#e5e5e6",line="#d4d4d5",fg="#383a42",muted="#696c77",
     primary="#4078f2",danger="#e45649",ok="#50a14f",warn="#c18401",ink="#ffffff"),
 ("rosepine","dark"): dict(bg="#191724",card="#1f1d2e",raised="#26233a",line="#403d52",fg="#e0def4",muted="#908caa",
     primary="#c4a7e7",danger="#eb6f92",ok="#9ccfd8",warn="#f6c177",ink="#191724"),
 ("rosepine","light"): dict(bg="#f2e9e1",card="#fffaf3",raised="#f4ede8",line="#dfdad9",fg="#575279",muted="#797593",
     primary="#907aa9",danger="#b4637a",ok="#286983",warn="#ea9d34",ink="#ffffff"),
}

report=[]
def tokens(key, p):
    mode=key[1]
    surfaces=[p["bg"],p["card"]]
    out={}
    far = "#000000" if mode=="light" else "#ffffff"
    fg,_=nudge(p["fg"], surfaces+[p["raised"]], 4.5, far)
    muted,m=nudge(p["muted"], surfaces, 4.5, fg)
    if m: report.append(f"{key}: muted {p['muted']}->{muted}")
    # Light palettes hold badge colours to AA as text, as arrdeck's own light
    # theme always has; dark ones to 3:1, the bar arrdeck's dark theme meets,
    # which keeps Dracula's red and Solarized's blue their own.
    status_bar = 4.5 if mode == "light" else 3.0
    def status(name):
        c,i=nudge(p[name], [p["raised"], p["card"]], status_bar, far)
        if i: report.append(f"{key}: {name} {p[name]}->{c}")
        return c
    primary=status("primary"); danger=status("danger"); ok=status("ok"); warn=status("warn")
    def label(bg):
        best=max([p["ink"],"#ffffff",p["bg"],"#000000"], key=lambda c: contrast(c,bg))
        if contrast(best,bg)<4.5: raise SystemExit(f"{key}: no label for {bg}")
        return best
    out.update({
      "background":p["bg"],"foreground":fg,"card":p["card"],"card-foreground":fg,
      "popover":p["raised"] if mode=="dark" else p["card"],"popover-foreground":fg,
      "primary":primary,"primary-foreground":label(primary),
      "secondary":p["raised"],"secondary-foreground":fg,
      "muted":p["raised"],"muted-foreground":muted,
      "accent":p["line"] if mode=="dark" else p["raised"],"accent-foreground":fg,
      "destructive":danger,"destructive-foreground":label(danger),
      "border":p["line"],"input":p["line"],"ring":primary,
      "success":ok,"warning":warn,
      "shadow-color":"rgb(0 0 0 / 0.5)" if mode=="dark" else "rgb(0 0 0 / 0.14)",
    })
    return out

DARK_ONLY={"dracula"}
css=[]
swift={}
for key,p in P.items():
    name,mode=key
    t=tokens(key,p)
    sel=f':root[data-palette="{name}"]' + ('[data-theme="light"]' if mode=="light" else "")
    body="\n".join(f"  --{k}: {v};" for k,v in t.items())
    css.append(f"{sel} {{\n{body}\n  color-scheme: {mode};\n}}")
    swift.setdefault(name,{})[mode]=t
out = sys.argv[1] if len(sys.argv) > 1 else "."
open(f"{out}/palettes.css","w").write("\n\n".join(css)+"\n")
json.dump(swift, open(f"{out}/palettes.json","w"), indent=1)
print("\n".join(report) or "no nudges")
