"""Printable documents. Prices supplied to this module already include 10% tax."""
import re
import ctypes
from pathlib import Path
from ctypes.util import find_library
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
pdfmetrics.registerFont(UnicodeCIDFont("HeiseiKakuGo-W5"))

from decimal import Decimal, ROUND_HALF_UP
from io import BytesIO
from xml.sax.saxutils import escape
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Paragraph

GREEN = colors.HexColor("#163F35")
GOLD = colors.HexColor("#B19149")


pdfmetrics.registerFont(TTFont("NotoArabic", str(Path(__file__).parent / "assets" / "NotoNaskhArabic-Regular.ttf")))
_bidi = ctypes.CDLL(find_library("fribidi") or "libfribidi.so.0")
_char = ctypes.c_uint32
_bidi.fribidi_log2vis.argtypes = [ctypes.POINTER(_char), ctypes.c_int, ctypes.POINTER(_char),
                                 ctypes.POINTER(_char), ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p]


def printable_markup(text):
    def arabic(match):
        run = match.group()
        chars = (_char * len(run))(*map(ord, run))
        visual = (_char * len(run))()
        direction = _char(0x111)  # FRIBIDI_PAR_RTL
        _bidi.fribidi_log2vis(chars, len(run), ctypes.byref(direction), visual, None, None, None)
        shaped = "".join(chr(v) for v in visual if v not in (0, 0xfeff))
        return '<font name="NotoArabic">'+escape(shaped)+'</font>'
    text = escape(str(text or "")).replace("\n","<br/>")
    text = re.sub(r"[\u0600-\u06ff]+(?:[ ]+[\u0600-\u06ff]+)*", arabic, text)
    return re.sub(r"[\u3000-\u30ff\u3400-\u9fff\uff00-\uffef]+", lambda m: '<font name="HeiseiKakuGo-W5">'+m.group()+'</font>', text)


def split_prices(prices):
    gross = sum(prices)
    net = int((Decimal(gross) * 10 / 11).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    # Allocate the invoice-level rounding difference to the largest remainders.
    lines = [p * 10 // 11 for p in prices]
    order = sorted(range(len(prices)), key=lambda i: prices[i] * 10 % 11, reverse=True)
    for i in order[:net - sum(lines)]:
        lines[i] += 1
    return lines, net, gross - net, gross


def yen(n):
    return f"¥{n:,}"


def invoice_pdf(doc):
    out = BytesIO()
    w, h = A4
    c = Canvas(out, pagesize=A4)
    c.setTitle(doc["number"])
    margin = 36
    def paragraph(value, x, top, width, size=10, bold=False):
        style = ParagraphStyle("cell", fontName="Helvetica-Bold" if bold else "Helvetica",
                               fontSize=size, leading=size+3, textColor=GREEN, wordWrap="CJK")
        p = Paragraph(printable_markup(value), style)
        _, height = p.wrap(width, h)
        p.drawOn(c, x, top-height)
        return top-height
    def header(first):
        c.setFillColor(GREEN)
        c.setFont("Helvetica-Bold", 19)
        c.drawCentredString(w/2, h-40, "INVOICE")
        c.setFont("Helvetica", 9)
        c.drawRightString(w-margin, h-56, doc["number"])
        c.drawRightString(w-margin, h-69, doc["date"])
        y = h-84
        if first:
            ends = []
            for key, x, top in [("from", margin, y), ("to", w/2+12, y-10)]:
                party = doc[key]
                top = paragraph(key.upper(), x, top, 248, 8, True)-3
                top = paragraph(party.get("name"), x, top, 244, 13, True)-4
                fields = ["address","phone","email"]
                if key == "from":
                    fields += ["tax_id","bank_details","bank_name","branch","branch_code","account_number","account_name"]
                for f in fields:
                    if party.get(f):
                        label = f.replace("_"," ").title()+": " if f not in ("address","email","phone") else ""
                        top = paragraph(label+str(party[f]),x,top,244,9)-1
                ends.append(top)
            y = min(ends)-14
            c.setFillColor(GREEN)
            c.setFont("Helvetica-Bold",13)
            c.drawRightString(w-margin,y,"Invoice total   "+yen(total))
            y -= 12
        c.setFillColor(GREEN)
        c.rect(margin,y-20,w-2*margin,20,fill=1,stroke=0)
        c.setFillColor(colors.white)
        c.setFont("Helvetica-Bold",9)
        for x, name in zip([40,109,278,407,461],["Date","Vehicle","Chassis number","Qty","Price excl. tax"]):
            c.drawString(x,y-14,name)
        return y-20
    rows = doc["rows"]
    nets, subtotal, tax, total = split_prices([r["gross"] for r in rows])
    y = header(True)
    for row, value in zip(rows, nets):
        if y < 151:
            c.showPage()
            y = header(False)
        ends = [paragraph(row["date"],40,y-5,65,9),paragraph(row["name"],109,y-5,162,9),
                paragraph(row["chassis"],278,y-5,122,9),paragraph("1",410,y-5,24,9)]
        c.setFillColor(GREEN)
        c.setFont("Helvetica",10)
        c.drawRightString(w-margin-4,y-15,yen(value))
        y = min(ends)-6
        c.setStrokeColor(colors.HexColor("#DDDFD9"))
        c.line(margin,y,w-margin,y)
    if y < 116:
        c.showPage()
    c.setStrokeColor(GOLD)
    c.line(w/2,107,w-margin,107)
    for y, label, amount in [(88,"Subtotal",subtotal),(70,"Tax (10%)",tax),(45,"Total incl. tax",total)]:
        c.setFont("Helvetica-Bold" if y==45 else "Helvetica",12 if y==45 else 10)
        c.setFillColor(GREEN)
        c.drawString(w/2+6,y,label)
        c.drawRightString(w-margin,y,yen(amount))
    c.save()
    return out.getvalue()


def auto_parts_invoice_pdf(doc):
    """Two-page minimum A4 invoice: engine sheets, then chassis and parts."""
    out = BytesIO()
    c = Canvas(out, pagesize=A4)
    w, h = A4
    c.setTitle(doc["number"])
    margin, right = 25, w - 25
    width = right - margin
    sections = doc.get("sections") or {}
    engines = sections.get("engines") or []
    chassis = sections.get("chassis") or []
    parts = sections.get("parts") or []
    total = sum(int(row.get("price") or 0) for rows in (engines, chassis, parts) for row in rows)
    engine_pages = max(1, (len(engines) + 59) // 60)
    def header(title, first=False):
        c.setFillColor(GREEN)
        c.setFont("Helvetica-Bold", 16)
        c.drawString(margin, h-36, "MADINA TRADING")
        company = doc.get("to") or {}
        style = ParagraphStyle("auto_parts_header", fontName="Helvetica", fontSize=8, leading=10, textColor=GREEN)
        p = Paragraph(printable_markup(company.get("address") or ""), style)
        _, ph = p.wrap(300, 60)
        p.drawOn(c, margin, h-42-ph)
        c.setFont("Helvetica-Bold", 10)
        c.drawRightString(right, h-35, doc["number"])
        c.setFont("Helvetica", 9)
        c.drawRightString(right, h-50, "Loading: " + str(doc.get("loading_date") or ""))
        c.setFont("Helvetica-Bold", 11)
        c.drawCentredString(w/2, h-92, title)
        c.setFont("Helvetica-Bold", 10)
        c.drawRightString(right, h-108, "GRAND TOTAL: JPY {:,}".format(total))
        c.setStrokeColor(GOLD)
        c.line(margin, h-115, right, h-115)
        return h-129
    def table(title, rows, start, count, ytop, row_height):
        c.setFillColor(GREEN)
        c.setFont("Helvetica-Bold", 10)
        c.drawCentredString(w/2, ytop, title)
        top = ytop - 9
        col = [margin, margin+29, margin+width/2-75, margin+width/2,
               margin+width/2+29, right-75, right]
        bottom = top - (count+1)*row_height
        c.setStrokeColor(colors.HexColor("#64748B"))
        c.setLineWidth(0.55)
        for x in col:
            c.line(x, top, x, bottom)
        for i in range(count+2):
            y = top-i*row_height
            c.line(margin,y,right,y)
        c.setFont("Helvetica-Bold",7.5)
        for j, label in enumerate(("No.","Number / Description","Price","No.","Number / Description","Price")):
            c.drawString(col[j]+3, top-row_height+4, label)
        c.setFont("Helvetica",7.5)
        for i in range(count):
            for side in (0,1):
                idx = start+i+side*count
                row = rows[idx] if idx < len(rows) else {}
                base = side*3
                y = top-(i+2)*row_height+4
                c.drawString(col[base]+5,y,str(idx+1))
                desc = str(row.get("number") or "")[:31]
                c.drawString(col[base+1]+3,y,desc)
                if row.get("price") not in ("",None):
                    c.drawRightString(col[base+3]-4,y,"{:,}".format(int(row["price"])))
        return bottom
    for page in range(engine_pages):
        y = header("ENGINE LIST")
        table("ENGINE LIST", engines, page*60, 30, y, 19)
        c.showPage()
    y = header("CHASSIS & PARTS LIST")
    bottom = table("CHASSIS LIST", chassis, 0, 6, y, 21)
    table("PARTS LIST", parts, 0, 20, bottom-24, 20)
    c.save()
    return out.getvalue()
